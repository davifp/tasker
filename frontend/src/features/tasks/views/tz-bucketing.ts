import { formatInTimeZone } from 'date-fns-tz';
import type { Task } from '@/lib/http/types';

// Timezone-aware bucketing for the Calendar view. The `dueDate` we get
// from the API is an ISO instant; the bucket key must be the calendar
// day of that instant AS OBSERVED IN THE WORKSPACE TIMEZONE, not the
// browser's local zone. Otherwise two team members in different zones
// see the same task drop into different day cells.
//
// The bucket key is `YYYY-MM-DD` (workspace-tz calendar day). We use
// this shape because it collates lexicographically, round-trips through
// URL params, and matches the `id` shape a `react-day-picker` `Day`
// cell can derive from its own `day.date` via the same helper.

export type DayBucketKey = string;

// Format an ISO timestamp as the YYYY-MM-DD calendar day observed in
// the given IANA timezone.
//
// Defensive fallback: `date-fns-tz` throws `Invalid time value` when
// handed an unknown IANA identifier. Today `workspaceTimezone` is a
// hardcoded `'UTC'` from the server shell, but Task 8 will source it
// from `Workspace.timezone` — a bad or legacy value would otherwise
// crash the whole Calendar during `useMemo`, upstream of any query
// error boundary. Swallow and fall back to UTC so the grid renders.
export function bucketKeyForIso(
  iso: string,
  workspaceTimezone: string,
): DayBucketKey {
  try {
    return formatInTimeZone(new Date(iso), workspaceTimezone, 'yyyy-MM-dd');
  } catch {
    return formatInTimeZone(new Date(iso), 'UTC', 'yyyy-MM-dd');
  }
}

// Format a `Date` (typically constructed by `react-day-picker` in the
// browser TZ, midnight-local) as the same YYYY-MM-DD key. Because a
// react-day-picker date represents "the day cell" (a wall-clock
// concept, not an instant), we read its Y/M/D components directly
// instead of converting through TZ math — that way a cell rendered
// for "July 15" always keys under `2026-07-15` regardless of the
// browser's zone.
export function bucketKeyForDayDate(date: Date): DayBucketKey {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface DayBucket {
  key: DayBucketKey;
  tasks: Task[];
}

// Group tasks by their workspace-tz calendar day. Tasks with a null
// `dueDate` are excluded — the Calendar view surfaces only dated work;
// undated tasks stay visible in List / Backlog / Kanban.
export function bucketTasksByDay(
  tasks: readonly Task[],
  workspaceTimezone: string,
): Map<DayBucketKey, Task[]> {
  const buckets = new Map<DayBucketKey, Task[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = bucketKeyForIso(task.dueDate, workspaceTimezone);
    const list = buckets.get(key);
    if (list) {
      list.push(task);
      continue;
    }
    buckets.set(key, [task]);
  }
  return buckets;
}
