import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    update: vi.fn(),
  },
}));

import { tasksHttp } from '@/lib/http/tasks';
import { useUpdateTask } from './useUpdateTask';

const WS = 'ws-1';
const PROJ = 'p-1';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: WS,
    projectId: 'p-uid',
    number: 42,
    title: 'Original',
    description: '',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    position: 'a0',
    assigneeUserId: null,
    createdByUserId: 'u-1',
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useUpdateTask', () => {
  it('applies the patch optimistically to detail and list caches', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const detailKey = taskKeys.detail(WS, PROJ, 42);
    const listKey = taskKeys.list(WS, PROJ);
    queryClient.setQueryData<Task>(detailKey, makeTask());
    queryClient.setQueryData<CursorPage<Task>>(listKey, {
      items: [makeTask()],
      nextCursor: null,
    });

    vi.mocked(tasksHttp.update).mockResolvedValueOnce(makeTask({ title: 'Renamed' }));

    const { result } = renderHook(() => useUpdateTask(WS, PROJ), { wrapper });
    result.current.mutate({ number: 42, patch: { title: 'Renamed' } });

    // Optimistic state visible IMMEDIATELY after mutate (before the promise resolves).
    await waitFor(() => {
      const detail = queryClient.getQueryData<Task>(detailKey);
      expect(detail?.title).toBe('Renamed');
    });
    const list = queryClient.getQueryData<CursorPage<Task>>(listKey);
    expect(list?.items[0]?.title).toBe('Renamed');
  });

  it('rolls back both detail and list on server error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const detailKey = taskKeys.detail(WS, PROJ, 42);
    const listKey = taskKeys.list(WS, PROJ);
    queryClient.setQueryData<Task>(detailKey, makeTask());
    queryClient.setQueryData<CursorPage<Task>>(listKey, {
      items: [makeTask()],
      nextCursor: null,
    });

    vi.mocked(tasksHttp.update).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useUpdateTask(WS, PROJ), { wrapper });
    result.current.mutate({ number: 42, patch: { title: 'Renamed' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Task>(detailKey)?.title).toBe('Original');
    expect(
      queryClient.getQueryData<CursorPage<Task>>(listKey)?.items[0]?.title,
    ).toBe('Original');
  });
});
