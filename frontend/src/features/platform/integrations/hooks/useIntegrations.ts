'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntegrationProviderName } from '@tasker/config';
import { integrationsHttp } from '../http';

const integrationsKey = (workspaceSlug: string) =>
  ['platform', workspaceSlug, 'integrations'] as const;

export function useIntegrations(workspaceSlug: string) {
  return useQuery({
    queryKey: integrationsKey(workspaceSlug),
    queryFn: () => integrationsHttp.list(workspaceSlug),
    enabled: Boolean(workspaceSlug),
    staleTime: 30_000,
  });
}

export function useDisconnectIntegration(workspaceSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: IntegrationProviderName) =>
      integrationsHttp.disconnect(workspaceSlug, provider),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: integrationsKey(workspaceSlug) });
    },
  });
}

export function useStartGithubConnection(workspaceSlug: string) {
  return useMutation({
    mutationFn: (returnTo?: string) => integrationsHttp.startGithub(workspaceSlug, returnTo),
  });
}
