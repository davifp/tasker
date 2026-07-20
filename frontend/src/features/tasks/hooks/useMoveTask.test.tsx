import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import { HttpError } from '@/lib/http/errors';
import type { CursorPage, Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    move: vi.fn(),
  },
}));

// Import AFTER the mock so useMoveTask picks up the mocked module.
import { tasksHttp } from '@/lib/http/tasks';
import { useMoveTask } from './useMoveTask';

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
    startDate: null,
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useMoveTask', () => {
  it('optimistically applies status+position; rolls back on 4xx', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const listKey = taskKeys.list(WS, PROJ);
    const page: CursorPage<Task> = { items: [makeTask()], nextCursor: null };
    queryClient.setQueryData<CursorPage<Task>>(listKey, page);

    vi.mocked(tasksHttp.move).mockRejectedValueOnce(
      new HttpError({
        type: 'https://tasker.dev/problems/stale-write',
        title: 'Stale',
        status: 409,
      }),
    );

    const { result } = renderHook(() => useMoveTask(WS, PROJ), { wrapper });
    result.current.mutate({
      number: 42,
      status: 'DONE',
      position: 'a1',
      ifUnchangedSince: '2026-07-17T00:00:00.000Z',
      targetBefore: 'a0',
      targetAfter: null,
      targetStatus: 'DONE',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Rollback: the list should hold the pre-mutation snapshot.
    const after = queryClient.getQueryData<CursorPage<Task>>(listKey);
    expect(after?.items[0]?.status).toBe('BACKLOG');
    expect(after?.items[0]?.position).toBe('a0');
  });

  it('retries once with a fresh position on 409 position-conflict', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    vi.mocked(tasksHttp.move)
      .mockRejectedValueOnce(
        new HttpError({
          type: 'https://tasker.dev/problems/position-conflict',
          title: 'Slot taken',
          status: 409,
        }),
      )
      .mockResolvedValueOnce(makeTask({ status: 'IN_PROGRESS', position: 'a5' }));

    const { result } = renderHook(() => useMoveTask(WS, PROJ), { wrapper });
    result.current.mutate({
      number: 42,
      status: 'IN_PROGRESS',
      position: 'a0',
      ifUnchangedSince: '2026-07-17T00:00:00.000Z',
      targetBefore: 'a4',
      targetAfter: null,
      targetStatus: 'IN_PROGRESS',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(tasksHttp.move).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(tasksHttp.move).mock.calls[1];
    // Second call should have a fresh position derived from the tail.
    expect(secondCall![3]?.position).not.toBe('a0');
    expect(secondCall![3]?.position.length).toBeGreaterThan(1);
  });

  it('surfaces the second position-conflict without retrying again', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    vi.mocked(tasksHttp.move).mockRejectedValue(
      new HttpError({
        type: 'https://tasker.dev/problems/position-conflict',
        title: 'Slot taken',
        status: 409,
      }),
    );

    const { result } = renderHook(() => useMoveTask(WS, PROJ), { wrapper });
    result.current.mutate({
      number: 42,
      status: 'IN_PROGRESS',
      position: 'a0',
      ifUnchangedSince: '2026-07-17T00:00:00.000Z',
      targetBefore: 'a4',
      targetAfter: null,
      targetStatus: 'IN_PROGRESS',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(tasksHttp.move).toHaveBeenCalledTimes(2);
    expect((result.current.error as HttpError).type).toBe(
      'https://tasker.dev/problems/position-conflict',
    );
  });
});
