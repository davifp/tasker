import { browserHttp } from './browser';
import type { CursorPage, MoveTaskResponse, Priority, Task, TaskStatus } from './types';

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeUserId?: string;
  dueDate?: string;
  labelIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: Priority;
  assigneeUserId?: string | null;
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
  status?: TaskStatus;
  assigneeUserId?: string;
  labelId?: string;
  labelIds?: readonly string[];
  includeDeleted?: boolean;
}

function base(workspaceSlug: string, projectSlug: string): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
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
    // Backend accepts `?labels=id1,id2` (comma-separated) for multi-select;
    // `labelId` remains the single-value legacy path.
    const { labelIds, ...rest } = input;
    const wire: Record<string, unknown> = { ...rest };
    if (labelIds && labelIds.length > 0) wire.labels = Array.from(labelIds);
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
