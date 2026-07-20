import { browserHttp } from './browser';
import type { CursorPage, MoveTaskResponse, Priority, Task, TaskStatus } from './types';

// Sort surface mirrored from the backend `ListTasksQueryDto.sort` enum.
// Kept in sync manually — a shared package would be overkill for two
// string unions but grep-visible via the type name.
export type TaskSortField = 'dueDate' | 'updatedAt' | 'priority' | 'title' | 'position';

export type TaskSortDir = 'asc' | 'desc';

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeUserId?: string;
  startDate?: string;
  dueDate?: string;
  labelIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: Priority;
  assigneeUserId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export interface MoveTaskInput {
  status: TaskStatus;
  position: string;
  ifUnchangedSince: string;
  overrideBlockers?: boolean;
}

export interface ListTasksInput {
  cursor?: string;
  limit?: number;
  status?: TaskStatus | readonly TaskStatus[];
  assigneeUserId?: string;
  labelId?: string;
  labelIds?: readonly string[];
  priority?: readonly Priority[];
  from?: string;
  to?: string;
  sort?: TaskSortField;
  sortDir?: TaskSortDir;
  includeDeleted?: boolean;
}

function base(workspaceSlug: string, projectSlug: string): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
      continue;
    }
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const tasksHttp = {
  list(workspaceSlug: string, projectSlug: string, input: ListTasksInput = {}) {
    // Backend accepts CSV for multi-select filters (`labels`, `status`,
    // `priority`); the single-value legacy path stays under `labelId`.
    const { labelIds, status, priority, ...rest } = input;
    const wire: Record<string, unknown> = { ...rest };
    if (labelIds && labelIds.length > 0) wire.labels = Array.from(labelIds);
    if (status !== undefined) {
      wire.status = Array.isArray(status) ? Array.from(status) : status;
    }
    if (priority && priority.length > 0) wire.priority = Array.from(priority);
    return browserHttp.get<CursorPage<Task>>(`${base(workspaceSlug, projectSlug)}${toQuery(wire)}`);
  },
  findByNumber(workspaceSlug: string, projectSlug: string, number: number) {
    return browserHttp.get<Task>(`${base(workspaceSlug, projectSlug)}/${number}`);
  },
  create(
    workspaceSlug: string,
    projectSlug: string,
    input: CreateTaskInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<Task>(base(workspaceSlug, projectSlug), input, { idempotencyKey });
  },
  update(workspaceSlug: string, projectSlug: string, number: number, input: UpdateTaskInput) {
    return browserHttp.patch<Task>(`${base(workspaceSlug, projectSlug)}/${number}`, input);
  },
  move(workspaceSlug: string, projectSlug: string, number: number, input: MoveTaskInput) {
    return browserHttp.post<MoveTaskResponse>(
      `${base(workspaceSlug, projectSlug)}/${number}/move`,
      input,
    );
  },
  remove(workspaceSlug: string, projectSlug: string, number: number) {
    return browserHttp.delete<void>(`${base(workspaceSlug, projectSlug)}/${number}`);
  },
  restore(workspaceSlug: string, projectSlug: string, number: number) {
    return browserHttp.post<Task>(`${base(workspaceSlug, projectSlug)}/${number}/restore`);
  },
};
