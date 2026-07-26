import type {
  CapacityUpsertInput,
  CreateSprintInput,
  ListSprintsQuery,
  SprintTasksMutationInput,
  UpdateSprintInput,
} from '@tasker/config';
import { browserHttp } from './browser';
import type { CursorPage } from './types';

/**
 * Mirror of the backend `Sprint` view. Kept as a nominal alias next to the
 * HTTP client so downstream feature slices import a single shape.
 */
export interface Sprint {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  name: string;
  goal: string | null;
  state: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  startDate: string;
  endDate: string;
  startedAt: string | null;
  completedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SprintCloseSummary {
  sprintId: string;
  plannedCount: number;
  plannedEstimate: number;
  deliveredCount: number;
  deliveredEstimate: number;
  slippedCount: number;
  slippedEstimate: number;
  velocity: number;
  slippedTaskIds: string[];
}

function base(workspaceSlug: string, projectSlug: string): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/sprints`;
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

export const sprintsHttp = {
  list(workspaceSlug: string, projectSlug: string, input: ListSprintsQuery = { limit: 50 }) {
    return browserHttp.get<CursorPage<Sprint>>(
      `${base(workspaceSlug, projectSlug)}${toQuery(input as unknown as Record<string, unknown>)}`,
    );
  },
  detail(workspaceSlug: string, projectSlug: string, sprintNumber: number) {
    return browserHttp.get<Sprint>(`${base(workspaceSlug, projectSlug)}/${sprintNumber}`);
  },
  create(
    workspaceSlug: string,
    projectSlug: string,
    input: CreateSprintInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<Sprint>(base(workspaceSlug, projectSlug), input, { idempotencyKey });
  },
  update(
    workspaceSlug: string,
    projectSlug: string,
    sprintNumber: number,
    input: UpdateSprintInput,
  ) {
    return browserHttp.patch<Sprint>(`${base(workspaceSlug, projectSlug)}/${sprintNumber}`, input);
  },
  mutateTasks(
    workspaceSlug: string,
    projectSlug: string,
    sprintNumber: number,
    input: SprintTasksMutationInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<void>(
      `${base(workspaceSlug, projectSlug)}/${sprintNumber}/tasks`,
      input,
      { idempotencyKey },
    );
  },
  start(workspaceSlug: string, projectSlug: string, sprintNumber: number, idempotencyKey?: string) {
    return browserHttp.post<Sprint>(
      `${base(workspaceSlug, projectSlug)}/${sprintNumber}/start`,
      undefined,
      { idempotencyKey },
    );
  },
  complete(
    workspaceSlug: string,
    projectSlug: string,
    sprintNumber: number,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<SprintCloseSummary>(
      `${base(workspaceSlug, projectSlug)}/${sprintNumber}/complete`,
      undefined,
      { idempotencyKey },
    );
  },
  upsertCapacity(
    workspaceSlug: string,
    projectSlug: string,
    sprintNumber: number,
    input: CapacityUpsertInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<void>(
      `${base(workspaceSlug, projectSlug)}/${sprintNumber}/capacity`,
      input,
      { idempotencyKey },
    );
  },
};
