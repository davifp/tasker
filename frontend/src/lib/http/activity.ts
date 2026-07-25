import { browserHttp } from './browser';
import type { Activity, CursorPage } from './types';

export interface ListActivityOptions {
  cursor?: string;
  limit?: number;
}

function toQuery(opts: ListActivityOptions): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  return params.size > 0 ? `?${params.toString()}` : '';
}

export const activityHttp = {
  forTask(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    opts: ListActivityOptions = {},
  ) {
    return browserHttp.get<CursorPage<Activity>>(
      `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/activity${toQuery(opts)}`,
    );
  },
  forProject(workspaceSlug: string, projectSlug: string, opts: ListActivityOptions = {}) {
    return browserHttp.get<CursorPage<Activity>>(
      `/workspaces/${workspaceSlug}/projects/${projectSlug}/activity${toQuery(opts)}`,
    );
  },
};
