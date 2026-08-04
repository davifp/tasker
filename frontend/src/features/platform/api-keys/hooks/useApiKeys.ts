'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformKeys } from '@/features/queryKeys';
import { apiKeysHttp, type CreateApiKeyInput } from '../http';

export function useApiKeys(workspaceSlug: string, opts: { includeRevoked?: boolean } = {}) {
  return useQuery({
    queryKey: platformKeys.apiKeys(workspaceSlug, opts),
    queryFn: () => apiKeysHttp.list(workspaceSlug, opts),
    enabled: Boolean(workspaceSlug),
    staleTime: 30_000,
  });
}

export function useCreateApiKey(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      apiKeysHttp.create(workspaceSlug, input, buildIdempotencyKey('create')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.all(workspaceSlug) });
    },
  });
}

export function useRevokeApiKey(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      apiKeysHttp.revoke(workspaceSlug, keyId, buildIdempotencyKey(`revoke-${keyId}`)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.all(workspaceSlug) });
    },
  });
}

function buildIdempotencyKey(scope: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${scope}-${Date.now()}-${rand}`;
}
