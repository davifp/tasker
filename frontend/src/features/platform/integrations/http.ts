import { browserHttp } from '@/lib/http/browser';
import type { IntegrationProviderName } from '@tasker/config';

export type IntegrationState = 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';

export interface IntegrationSummary {
  id: string;
  provider: IntegrationProviderName;
  state: IntegrationState;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  config: Record<string, unknown>;
}

export interface StartConnectionResponse {
  authorizeUrl: string;
  scopes: string[];
}

export interface CompleteGithubConnectionResponse {
  integrationId: string;
  githubLogin: string;
}

function base(slug: string): string {
  return `/workspaces/${encodeURIComponent(slug)}/integrations`;
}

export const integrationsHttp = {
  list(slug: string): Promise<{ items: IntegrationSummary[] }> {
    return browserHttp.get<{ items: IntegrationSummary[] }>(base(slug));
  },
  disconnect(slug: string, provider: IntegrationProviderName): Promise<void> {
    return browserHttp.delete<void>(`${base(slug)}/${encodeURIComponent(provider)}`);
  },
  startGithub(slug: string, returnTo?: string): Promise<StartConnectionResponse> {
    return browserHttp.post<StartConnectionResponse>(
      `${base(slug)}/github/start`,
      returnTo ? { returnTo } : {},
    );
  },
  completeGithub(
    slug: string,
    code: string,
    state: string,
    idempotencyKey: string,
  ): Promise<CompleteGithubConnectionResponse> {
    return browserHttp.post<CompleteGithubConnectionResponse>(
      `${base(slug)}/github/complete`,
      { code, state },
      { idempotencyKey },
    );
  },
  startGoogleCalendar(slug: string, returnTo?: string): Promise<StartConnectionResponse> {
    return browserHttp.post<StartConnectionResponse>(
      `${base(slug)}/google-calendar/start`,
      returnTo ? { returnTo } : {},
    );
  },
  completeGoogleCalendar(
    slug: string,
    code: string,
    state: string,
    idempotencyKey: string,
  ): Promise<{ integrationId: string; googleEmail: string }> {
    return browserHttp.post<{ integrationId: string; googleEmail: string }>(
      `${base(slug)}/google-calendar/complete`,
      { code, state },
      { idempotencyKey },
    );
  },
};
