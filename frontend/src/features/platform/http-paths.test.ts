import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/browser', () => {
  const seen: { method: string; path: string }[] = [];
  const record = (method: string) => (path: string) => {
    seen.push({ method, path });
    return Promise.resolve(undefined);
  };
  return {
    __seen: seen,
    browserHttp: {
      get: record('GET'),
      post: record('POST'),
      patch: record('PATCH'),
      put: record('PUT'),
      delete: record('DELETE'),
    },
  };
});

import * as browserMod from '@/lib/http/browser';
import { apiKeysHttp } from './api-keys/http';
import { webhooksHttp } from './webhooks/http';
import { integrationsHttp } from './integrations/http';

const seen = (browserMod as unknown as { __seen: { method: string; path: string }[] }).__seen;

describe('platform feature clients — proxy path contract', () => {
  it('never prepends /api/v1 (the proxy does that)', async () => {
    seen.length = 0;

    await apiKeysHttp.list('ws');
    await apiKeysHttp.create('ws', { name: 'k', scopes: ['tasks:read'] }, 'idem');
    await apiKeysHttp.revoke('ws', 'key-1', 'idem');

    await webhooksHttp.list('ws');
    await webhooksHttp.create('ws', { url: 'https://x', eventTypes: ['TASK_CREATED'] }, 'idem');
    await webhooksHttp.remove('ws', 'wh-1');
    await webhooksHttp.rotateSecret('ws', 'wh-1', 'idem');
    await webhooksHttp.listDeliveries('ws', 'wh-1');
    await webhooksHttp.listDlq('ws', 'wh-1');

    await integrationsHttp.list('ws');
    await integrationsHttp.disconnect('ws', 'GITHUB');
    await integrationsHttp.startGithub('ws');
    await integrationsHttp.completeGithub('ws', 'c', 's', 'idem');
    await integrationsHttp.startGoogleCalendar('ws');
    await integrationsHttp.completeGoogleCalendar('ws', 'c', 's', 'idem');

    expect(seen.length).toBeGreaterThan(0);
    for (const { path } of seen) {
      expect(path.startsWith('/api/v1/')).toBe(false);
      expect(path.startsWith('/workspaces/ws/')).toBe(true);
    }
  });
});
