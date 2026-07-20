import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    list: vi.fn(),
  },
}));

import { tasksHttp } from '@/lib/http/tasks';
import { useProjectTasks } from './useProjectTasks';

const WS = 'ws-1';
const PROJ = 'p-1';

function makePage(): CursorPage<Task> {
  return {
    items: [
      {
        id: 't-1',
        workspaceId: WS,
        projectId: 'p-uid',
        number: 1,
        title: 'A',
        description: '',
        status: 'TODO',
        priority: 'MEDIUM',
        position: 'a0',
        assigneeUserId: null,
        createdByUserId: 'u-1',
        startDate: null,
        dueDate: null,
        deletedAt: null,
        purgeAt: null,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    ],
    nextCursor: null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useProjectTasks', () => {
  it('fetches once and returns a CursorPage<Task>', async () => {
    vi.mocked(tasksHttp.list).mockResolvedValue(makePage());
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const { result } = renderHook(
      () => useProjectTasks(WS, PROJ, { status: ['TODO'] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(1);
    expect(tasksHttp.list).toHaveBeenCalledTimes(1);
  });

  it('two views mounted with the same filters share the cache — one fetch', async () => {
    vi.mocked(tasksHttp.list).mockResolvedValue(makePage());
    // staleTime: Infinity mirrors the production `Providers` cache
    // (staleTime = 60s ≫ a single view switch) so mounting a second
    // consumer of the same canonical key doesn't trigger a background
    // refetch. Without this the default staleTime = 0 would race a
    // refetch on every mount and the "one fetch across views" invariant
    // wouldn't be observable in the test.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const wrapper = makeWrapper({ queryClient });

    // View A — filter set typed one way.
    const { result: viewA } = renderHook(
      () =>
        useProjectTasks(WS, PROJ, {
          status: ['TODO', 'IN_PROGRESS'],
          labelIds: ['lbl-b', 'lbl-a'],
        }),
      { wrapper },
    );
    await waitFor(() => expect(viewA.current.isSuccess).toBe(true));

    // View B — permutation of the same filter set: sorted arrays in the
    // canonicalized key resolve to the same cache entry. If the key were
    // NOT canonicalized this second mount would fire a second fetch.
    const { result: viewB } = renderHook(
      () =>
        useProjectTasks(WS, PROJ, {
          labelIds: ['lbl-a', 'lbl-b'],
          status: ['IN_PROGRESS', 'TODO'],
        }),
      { wrapper },
    );

    // The synchronous first render reads straight from the cache — no
    // extra fetch is queued.
    expect(viewB.current.data?.items).toHaveLength(1);
    expect(tasksHttp.list).toHaveBeenCalledTimes(1);

    // Belt + braces: the two permutations must resolve to the SAME
    // TanStack Query cache entry (identity check via getQueryData).
    const dataViaA = queryClient.getQueryData(
      taskKeys.list(WS, PROJ, {
        status: ['TODO', 'IN_PROGRESS'],
        labelIds: ['lbl-b', 'lbl-a'],
      }),
    );
    const dataViaB = queryClient.getQueryData(
      taskKeys.list(WS, PROJ, {
        labelIds: ['lbl-a', 'lbl-b'],
        status: ['IN_PROGRESS', 'TODO'],
      }),
    );
    expect(dataViaA).toBe(dataViaB);
  });

  it('different filter sets produce separate cache entries and separate fetches', async () => {
    vi.mocked(tasksHttp.list).mockResolvedValue(makePage());
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const { result: a } = renderHook(
      () => useProjectTasks(WS, PROJ, { status: ['TODO'] }),
      { wrapper },
    );
    await waitFor(() => expect(a.current.isSuccess).toBe(true));

    const { result: b } = renderHook(
      () => useProjectTasks(WS, PROJ, { status: ['DONE'] }),
      { wrapper },
    );
    await waitFor(() => expect(b.current.isSuccess).toBe(true));

    expect(tasksHttp.list).toHaveBeenCalledTimes(2);
  });
});
