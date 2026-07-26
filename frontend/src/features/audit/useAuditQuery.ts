'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { auditHttp, type AuditListResult } from '@/lib/http/audit';
import type { AuditParams } from './auditParams';

export function auditQueryKey(workspaceSlug: string, params: AuditParams): unknown[] {
  const normalized: Record<string, unknown> = {};
  if (params.actorUserId) normalized.actorUserId = params.actorUserId;
  if (params.event) normalized.event = [...params.event].sort().join(',');
  if (params.targetType) normalized.targetType = [...params.targetType].sort().join(',');
  if (params.from) normalized.from = params.from;
  if (params.to) normalized.to = params.to;
  if (params.limit) normalized.limit = params.limit;
  return ['audit', workspaceSlug, normalized];
}

interface Options {
  workspaceSlug: string;
  params: AuditParams;
  enabled?: boolean;
}

export function useAuditQuery({ workspaceSlug, params, enabled = true }: Options) {
  return useInfiniteQuery<AuditListResult, Error>({
    queryKey: auditQueryKey(workspaceSlug, params),
    queryFn: ({ signal, pageParam }) =>
      auditHttp.list(workspaceSlug, { ...params, cursor: pageParam as string | undefined }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
    gcTime: 60_000,
  });
}
