import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/session/session', () => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock('@/lib/session/auth-backend', () => ({
  refreshBackend: vi.fn(),
}));
vi.mock('@/lib/session/workspace', () => ({
  getWorkspaceCookie: vi.fn(),
}));
vi.mock('@/lib/http/backend', () => ({
  apiUrl: (path: string) => `http://backend.test/api/v1${path}`,
}));

import { GET } from './route';
import { getSession } from '@/lib/session/session';
import { getWorkspaceCookie } from '@/lib/session/workspace';

async function invoke(path: string[], headers: Record<string, string> = {}): Promise<Request> {
  const request = new Request(
    `http://web.test/api/proxy/${path.map(encodeURIComponent).join('/')}`,
    {
      method: 'GET',
      headers,
    },
  );
  const context = { params: Promise.resolve({ path }) };
  await GET(request, context);
  return request;
}

describe('BFF proxy — [...path]/route.ts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    vi.mocked(getSession).mockResolvedValue({
      userId: 'u-1',
      accessToken: 'at',
      refreshToken: 'rt',
      accessExp: Math.floor(Date.now() / 1000) + 3600,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('injects X-Workspace-Id from the workspace cookie on workspace-agnostic paths', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue({ id: 'ws-1', slug: 'qa-acme' });

    await invoke(['notifications', 'unread-count']);

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe('http://backend.test/api/v1/notifications/unread-count');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('x-workspace-id')).toBe('ws-1');
    expect(headers.get('authorization')).toBe('Bearer at');
  });

  it('does not overwrite an X-Workspace-Id header the caller supplied', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue({ id: 'ws-cookie', slug: 'qa-acme' });

    await invoke(['notifications'], { 'X-Workspace-Id': 'ws-override' });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('x-workspace-id')).toBe('ws-override');
  });

  it('omits X-Workspace-Id when no workspace cookie has been set', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue(null);

    await invoke(['notifications']);

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.has('x-workspace-id')).toBe(false);
  });

  it('omits X-Workspace-Id on workspace-crossing paths', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue({ id: 'ws-1', slug: 'qa-acme' });

    // The invitation-accept flow: the recipient's session still carries the
    // last selected workspace cookie, but they are not yet a member of the
    // target workspace. Injecting X-Workspace-Id would trip WorkspaceGuard.
    await invoke(['invitations', 'token-xyz', 'accept']);

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.has('x-workspace-id')).toBe(false);
  });

  it('omits X-Workspace-Id on /me and /auth/*', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue({ id: 'ws-1', slug: 'qa-acme' });

    await invoke(['me']);
    let init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Headers).has('x-workspace-id')).toBe(false);

    vi.mocked(fetch).mockClear();
    await invoke(['auth', 'refresh']);
    init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Headers).has('x-workspace-id')).toBe(false);
  });

  it('keeps X-Workspace-Id on workspaces/:slug/... (matches URL slug)', async () => {
    vi.mocked(getWorkspaceCookie).mockResolvedValue({ id: 'ws-1', slug: 'qa-acme' });

    await invoke(['workspaces', 'qa-acme', 'invitations']);

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('x-workspace-id')).toBe('ws-1');
  });
});
