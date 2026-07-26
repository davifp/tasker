import type { CreateEpicInput, RoadmapQuery, UpdateEpicInput } from '@tasker/config';
import { browserHttp } from './browser';

export interface Epic {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  startQuarter: string;
  endQuarter: string;
  createdByUserId: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoadmapResponse {
  items: Epic[];
}

function workspaceBase(workspaceSlug: string): string {
  return `/workspaces/${workspaceSlug}`;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const epicsHttp = {
  create(
    workspaceSlug: string,
    projectSlug: string,
    input: CreateEpicInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<Epic>(
      `${workspaceBase(workspaceSlug)}/projects/${projectSlug}/epics`,
      input,
      { idempotencyKey },
    );
  },
  update(workspaceSlug: string, id: string, input: UpdateEpicInput) {
    return browserHttp.patch<Epic>(`${workspaceBase(workspaceSlug)}/epics/${id}`, input);
  },
  remove(workspaceSlug: string, id: string) {
    return browserHttp.delete<void>(`${workspaceBase(workspaceSlug)}/epics/${id}`);
  },
  linkTask(workspaceSlug: string, id: string, taskId: string, idempotencyKey?: string) {
    return browserHttp.post<void>(
      `${workspaceBase(workspaceSlug)}/epics/${id}/tasks/${taskId}`,
      undefined,
      { idempotencyKey },
    );
  },
  unlinkTask(workspaceSlug: string, id: string, taskId: string) {
    return browserHttp.delete<void>(`${workspaceBase(workspaceSlug)}/epics/${id}/tasks/${taskId}`);
  },
};

export const roadmapHttp = {
  list(workspaceSlug: string, input: RoadmapQuery = {}) {
    return browserHttp.get<RoadmapResponse>(
      `${workspaceBase(workspaceSlug)}/roadmap${toQuery(input as Record<string, unknown>)}`,
    );
  },
};
