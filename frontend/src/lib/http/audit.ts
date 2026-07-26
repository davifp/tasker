import type { AuditQueryInput } from '@tasker/config';
import { browserHttp } from './browser';

export interface AuditRow {
  id: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  event: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  traceId: string | null;
  createdAt: string;
}

export interface AuditListResult {
  rows: AuditRow[];
  nextCursor: string | null;
}

function buildQuery(params: Partial<AuditQueryInput>): string {
  const search = new URLSearchParams();
  if (params.actorUserId) search.set('actorUserId', params.actorUserId);
  if (params.event && params.event.length) search.set('event', params.event.join(','));
  if (params.targetType && params.targetType.length) {
    search.set('targetType', params.targetType.join(','));
  }
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  return search.toString();
}

export const auditHttp = {
  list(workspaceSlug: string, params: Partial<AuditQueryInput> = {}, signal?: AbortSignal) {
    const qs = buildQuery(params);
    return browserHttp.get<AuditListResult>(
      `/workspaces/${workspaceSlug}/audit${qs ? `?${qs}` : ''}`,
      { signal },
    );
  },
  csvExportUrl(workspaceSlug: string, params: Partial<AuditQueryInput> = {}): string {
    const qs = buildQuery(params);
    return `/api/proxy/workspaces/${workspaceSlug}/audit/export.csv${qs ? `?${qs}` : ''}`;
  },
};
