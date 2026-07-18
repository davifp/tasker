import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { projectKeys } from '@/features/queryKeys';
import type { CursorPage, Project } from '@/lib/http/types';

vi.mock('@/lib/http/projects', () => ({
  projectsHttp: {
    remove: vi.fn(),
    restore: vi.fn(),
  },
}));

import { projectsHttp } from '@/lib/http/projects';
import { useDeleteProjectWithUndo } from './useDeleteProjectWithUndo';

const WS = 'ws-1';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    workspaceId: WS,
    slug: 'web',
    name: 'Web',
    description: null,
    color: '#3b82f6',
    icon: 'Package',
    status: 'ACTIVE',
    ownerUserId: 'u-1',
    createdByUserId: 'u-1',
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useDeleteProjectWithUndo', () => {
  it('removes project from list then restores via undo', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const listKey = projectKeys.list(WS);
    queryClient.setQueryData<CursorPage<Project>>(listKey, {
      items: [makeProject(), makeProject({ id: 'p-2', slug: 'api' })],
      nextCursor: null,
    });

    vi.mocked(projectsHttp.remove).mockResolvedValueOnce(undefined);
    vi.mocked(projectsHttp.restore).mockResolvedValueOnce(makeProject());

    const { result } = renderHook(() => useDeleteProjectWithUndo(WS), { wrapper });
    const handle = await result.current.mutate({ projectSlug: 'web' });

    const afterDelete = queryClient.getQueryData<CursorPage<Project>>(listKey);
    expect(afterDelete?.items.map((p) => p.slug)).toEqual(['api']);

    await handle.undo();
    expect(projectsHttp.restore).toHaveBeenCalledWith(WS, 'web');
  });

  it('rolls back on server error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const listKey = projectKeys.list(WS);
    queryClient.setQueryData<CursorPage<Project>>(listKey, {
      items: [makeProject()],
      nextCursor: null,
    });

    vi.mocked(projectsHttp.remove).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useDeleteProjectWithUndo(WS), { wrapper });
    await expect(result.current.mutate({ projectSlug: 'web' })).rejects.toThrow('boom');
    expect(queryClient.getQueryData<CursorPage<Project>>(listKey)?.items).toHaveLength(1);
  });
});
