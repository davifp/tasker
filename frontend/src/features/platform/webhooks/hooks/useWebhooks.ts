'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformKeys } from '@/features/queryKeys';
import { webhooksHttp, type CreateWebhookInput, type UpdateWebhookInput } from '../http';

function buildIdempotencyKey(scope: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${scope}-${Date.now()}-${rand}`;
}

export function useWebhooks(workspaceSlug: string) {
  return useQuery({
    queryKey: platformKeys.webhooks(workspaceSlug),
    queryFn: () => webhooksHttp.list(workspaceSlug),
    enabled: Boolean(workspaceSlug),
    staleTime: 30_000,
  });
}

export function useCreateWebhook(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) =>
      webhooksHttp.create(workspaceSlug, input, buildIdempotencyKey('create-webhook')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.webhooks(workspaceSlug) });
    },
  });
}

export function useUpdateWebhook(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateWebhookInput }) =>
      webhooksHttp.update(workspaceSlug, vars.id, vars.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.webhooks(workspaceSlug) });
    },
  });
}

export function useDeleteWebhook(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksHttp.remove(workspaceSlug, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.webhooks(workspaceSlug) });
    },
  });
}

export function useRotateWebhookSecret(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      webhooksHttp.rotateSecret(workspaceSlug, id, buildIdempotencyKey(`rotate-${id}`)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.webhooks(workspaceSlug) });
    },
  });
}

export function useWebhookDeliveries(workspaceSlug: string, webhookId: string | null) {
  return useQuery({
    queryKey: platformKeys.webhookDeliveries(workspaceSlug, webhookId ?? ''),
    queryFn: () => webhooksHttp.listDeliveries(workspaceSlug, webhookId!),
    enabled: Boolean(workspaceSlug && webhookId),
    staleTime: 10_000,
  });
}

export function useWebhookDlq(workspaceSlug: string, webhookId: string | null) {
  return useQuery({
    queryKey: platformKeys.webhookDlq(workspaceSlug, webhookId ?? ''),
    queryFn: () => webhooksHttp.listDlq(workspaceSlug, webhookId!),
    enabled: Boolean(workspaceSlug && webhookId),
    staleTime: 30_000,
  });
}
