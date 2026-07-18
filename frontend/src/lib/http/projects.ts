import { browserHttp } from './browser';
import type { CursorPage, Project } from './types';

export interface CreateProjectInput {
  name: string;
  slug: string;
  color: string;
  icon: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  color?: string;
  icon?: string;
  description?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface ListProjectsInput {
  cursor?: string;
  limit?: number;
  status?: 'ACTIVE' | 'ARCHIVED';
  includeDeleted?: boolean;
}

function base(workspaceSlug: string): string {
  return `/workspaces/${workspaceSlug}/projects`;
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

export const projectsHttp = {
  list(workspaceSlug: string, input: ListProjectsInput = {}) {
    return browserHttp.get<CursorPage<Project>>(
      `${base(workspaceSlug)}${toQuery(input as Record<string, unknown>)}`,
    );
  },
  findBySlug(workspaceSlug: string, projectSlug: string) {
    return browserHttp.get<Project>(`${base(workspaceSlug)}/${projectSlug}`);
  },
  create(workspaceSlug: string, input: CreateProjectInput, idempotencyKey?: string) {
    return browserHttp.post<Project>(base(workspaceSlug), input, { idempotencyKey });
  },
  update(workspaceSlug: string, projectSlug: string, input: UpdateProjectInput) {
    return browserHttp.patch<Project>(`${base(workspaceSlug)}/${projectSlug}`, input);
  },
  remove(workspaceSlug: string, projectSlug: string) {
    return browserHttp.delete<void>(`${base(workspaceSlug)}/${projectSlug}`);
  },
  restore(workspaceSlug: string, projectSlug: string) {
    return browserHttp.post<Project>(`${base(workspaceSlug)}/${projectSlug}/restore`);
  },
};
