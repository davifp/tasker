// Google Calendar's event payload shape — only the fields we set. `date` for
// all-day (task with just dueDate), `dateTime` for scoped windows. The
// `iCalUID` gives us idempotency across upserts: same UID on the second POST
// updates the existing event, so we don't need to persist the Google event id.

export interface CalendarEventPayload {
  iCalUID: string;
  summary: string;
  description?: string;
  start: CalendarDateOrDateTime;
  end: CalendarDateOrDateTime;
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

export type CalendarDateOrDateTime =
  | { date: string; timeZone?: undefined; dateTime?: undefined }
  | { dateTime: string; timeZone?: string; date?: undefined };

export interface TaskExportInput {
  workspaceId: string;
  taskId: string;
  taskNumber: number;
  projectSlug: string;
  title: string;
  description?: string | null;
  status: string;
  startDate?: string | Date | null;
  dueDate?: string | Date | null;
}

export interface SprintExportInput {
  workspaceId: string;
  sprintId: string;
  name: string;
  goal?: string | null;
  startDate: string | Date;
  endDate: string | Date;
}

function toIsoDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

function isMidnightUtc(value: string | Date): boolean {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

/**
 * Build an all-day event when we only have dates, or a scoped event when we
 * have full timestamps. `iCalUID` is stable across upserts so Google
 * deduplicates by (calendarId, iCalUID) — the exporter can POST the same
 * payload on every task change and get update semantics for free.
 */
export function mapTaskToEvent(input: TaskExportInput): CalendarEventPayload | null {
  if (!input.startDate && !input.dueDate) return null;

  const summary = `[${input.projectSlug}#${input.taskNumber}] ${input.title}`;
  const iCalUID = buildTaskUid(input.workspaceId, input.taskId);
  // For soft-deleted tasks callers should map with status='cancelled' so the
  // event is tombstoned; here we always set 'confirmed' — the exporter flips
  // to 'cancelled' when it sees a delete event.
  const status = 'confirmed';

  if (input.startDate && input.dueDate) {
    const start = normaliseDateOrDateTime(input.startDate);
    const end = normaliseDateOrDateTime(input.dueDate);
    // All-day events use `date` and expect exclusive end — bump by 1 day
    // when both endpoints are dates so a same-day task shows as a single day.
    if ('date' in start && 'date' in end && start.date && end.date) {
      return {
        iCalUID,
        summary,
        ...(input.description ? { description: input.description } : {}),
        start,
        end: { date: addDaysIso(end.date, 1) },
        status,
      };
    }
    return {
      iCalUID,
      summary,
      ...(input.description ? { description: input.description } : {}),
      start,
      end,
      status,
    };
  }

  const only = input.startDate ?? input.dueDate!;
  const single = normaliseDateOrDateTime(only);
  if ('date' in single && single.date) {
    return {
      iCalUID,
      summary,
      ...(input.description ? { description: input.description } : {}),
      start: single,
      end: { date: addDaysIso(single.date, 1) },
      status,
    };
  }
  return {
    iCalUID,
    summary,
    ...(input.description ? { description: input.description } : {}),
    start: single,
    end: single,
    status,
  };
}

export function mapSprintToEvent(input: SprintExportInput): CalendarEventPayload {
  return {
    iCalUID: buildSprintUid(input.workspaceId, input.sprintId),
    summary: `[Sprint] ${input.name}`,
    ...(input.goal ? { description: input.goal } : {}),
    start: { date: toIsoDate(input.startDate) },
    end: { date: addDaysIso(toIsoDate(input.endDate), 1) },
    status: 'confirmed',
  };
}

export function buildTaskUid(workspaceId: string, taskId: string): string {
  return `task-${taskId}@${workspaceId}.tasker.local`;
}

export function buildSprintUid(workspaceId: string, sprintId: string): string {
  return `sprint-${sprintId}@${workspaceId}.tasker.local`;
}

function normaliseDateOrDateTime(value: string | Date): CalendarDateOrDateTime {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isMidnightUtc(d)) {
    return { date: toIsoDate(d) };
  }
  return { dateTime: d.toISOString(), timeZone: 'UTC' };
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
