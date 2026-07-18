import { browserHttp } from './browser';
import type { CursorPage, Label } from './types';

export interface CreateLabelInput {
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

export interface ListLabelsInput {
  cursor?: string;
  limit?: number;
}

function base(workspaceSlug: string): string {
  return `/workspaces/${workspaceSlug}/labels`;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const labelsHttp = {
  list(workspaceSlug: string, input: ListLabelsInput = {}) {
    return browserHttp.get<CursorPage<Label>>(
      `${base(workspaceSlug)}${toQuery(input as Record<string, unknown>)}`,
    );
  },
  create(workspaceSlug: string, input: CreateLabelInput, idempotencyKey?: string) {
    return browserHttp.post<Label>(base(workspaceSlug), input, { idempotencyKey });
  },
  update(workspaceSlug: string, id: string, input: UpdateLabelInput) {
    return browserHttp.patch<Label>(`${base(workspaceSlug)}/${id}`, input);
  },
  remove(workspaceSlug: string, id: string) {
    return browserHttp.delete<void>(`${base(workspaceSlug)}/${id}`);
  },
};
