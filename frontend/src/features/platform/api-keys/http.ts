import { browserHttp } from '@/lib/http/browser';
import type { ApiKeyScope } from '@tasker/config';

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByUserId: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  key: ApiKeySummary;
  rawKey: string;
}

function base(slug: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(slug)}/api-keys`;
}

export const apiKeysHttp = {
  list(slug: string, opts: { includeRevoked?: boolean } = {}): Promise<{ items: ApiKeySummary[] }> {
    const query = opts.includeRevoked ? '?includeRevoked=true' : '';
    return browserHttp.get<{ items: ApiKeySummary[] }>(`${base(slug)}${query}`);
  },
  create(
    slug: string,
    input: CreateApiKeyInput,
    idempotencyKey: string,
  ): Promise<CreateApiKeyResponse> {
    return browserHttp.post<CreateApiKeyResponse>(base(slug), input, { idempotencyKey });
  },
  revoke(slug: string, keyId: string, idempotencyKey: string): Promise<{ key: ApiKeySummary }> {
    return browserHttp.post<{ key: ApiKeySummary }>(
      `${base(slug)}/${encodeURIComponent(keyId)}/revoke`,
      undefined,
      { idempotencyKey },
    );
  },
};
