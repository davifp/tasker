import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    remove: vi.fn(),
    restore: vi.fn(),
  },
}));

import { tasksHttp } from '@/lib/http/tasks';
import { useDeleteTaskWithUndo } from './useDeleteTaskWithUndo';

const WS = 'ws-1';
const PROJ = 'p-1';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: WS,
    projectId: 'p-uid',
    number: 42,
    title: 'T',
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

describe('useDeleteTaskWithUndo', () => {
  it('removes the task from the list optimistically and exposes an undo handle that hits POST /restore', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const listKey = taskKeys.list(WS, PROJ);
    const page: CursorPage<Task> = {
      items: [makeTask({ number: 41, id: 't-41' }), makeTask({ number: 42, id: 't-42' })],
      nextCursor: null,
    };
    queryClient.setQueryData<CursorPage<Task>>(listKey, page);

    vi.mocked(tasksHttp.remove).mockResolvedValueOnce(undefined);
    vi.mocked(tasksHttp.restore).mockResolvedValueOnce(makeTask({ number: 42, id: 't-42' }));

    const { result } = renderHook(() => useDeleteTaskWithUndo(WS, PROJ), { wrapper });

    const handle = await result.current.mutate({ number: 42 });
    const listAfterDelete = queryClient.getQueryData<CursorPage<Task>>(listKey);
    expect(listAfterDelete?.items).toHaveLength(1);
    expect(listAfterDelete?.items[0]?.number).toBe(41);

    await handle.undo();
    expect(tasksHttp.restore).toHaveBeenCalledWith(WS, PROJ, 42);
  });

  it('rolls back the optimistic delete on server error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const listKey = taskKeys.list(WS, PROJ);
    queryClient.setQueryData<CursorPage<Task>>(listKey, {
      items: [makeTask({ number: 42, id: 't-42' })],
      nextCursor: null,
    });

    vi.mocked(tasksHttp.remove).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useDeleteTaskWithUndo(WS, PROJ), { wrapper });
    await expect(result.current.mutate({ number: 42 })).rejects.toThrow('boom');

    const restored = queryClient.getQueryData<CursorPage<Task>>(listKey);
    expect(restored?.items).toHaveLength(1);
    expect(restored?.items[0]?.number).toBe(42);
  });
});
