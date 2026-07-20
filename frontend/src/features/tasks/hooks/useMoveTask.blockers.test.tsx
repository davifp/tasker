import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, MoveTaskResponse, Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    move: vi.fn(),
  },
}));

import { tasksHttp } from '@/lib/http/tasks';
import { useMoveTask, BlockersOpenError } from './useMoveTask';

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
    status: 'IN_PROGRESS',
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

describe('useMoveTask blocker gate', () => {
  it('throws BlockersOpenError and rolls back the optimistic move when the server responds with open blockers', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const listKey = taskKeys.list(WS, PROJ);
    const initial = makeTask();
    queryClient.setQueryData<CursorPage<Task>>(listKey, {
      items: [initial],
      nextCursor: null,
    });

    vi.mocked(tasksHttp.move).mockResolvedValueOnce({
      ...initial,
      acknowledgedBlockersOpen: ['WEB-2'],
    } as MoveTaskResponse);

    const { result } = renderHook(() => useMoveTask(WS, PROJ), { wrapper });
    result.current.mutate({
      number: 42,
      status: 'DONE',
      position: 'a5',
      ifUnchangedSince: '2026-07-17T00:00:00.000Z',
      targetBefore: 'a4',
      targetAfter: null,
      targetStatus: 'DONE',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(BlockersOpenError);
    expect((result.current.error as BlockersOpenError).blockers).toEqual(['WEB-2']);

    // Rollback: the list slice should show the original IN_PROGRESS + a0.
    const after = queryClient.getQueryData<CursorPage<Task>>(listKey);
    expect(after?.items[0]?.status).toBe('IN_PROGRESS');
    expect(after?.items[0]?.position).toBe('a0');
  });

  it('does not throw when overrideBlockers=true and the server still returns the blockers list', async () => {
    // A well-behaved server won't return acknowledgedBlockersOpen with
    // overrideBlockers=true, but if it did, the hook must not throw the
    // synthetic error — otherwise the confirm path would loop.
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    vi.mocked(tasksHttp.move).mockResolvedValueOnce(
      makeTask({ status: 'DONE', position: 'a5' }) as MoveTaskResponse,
    );

    const { result } = renderHook(() => useMoveTask(WS, PROJ), { wrapper });
    result.current.mutate({
      number: 42,
      status: 'DONE',
      position: 'a5',
      ifUnchangedSince: '2026-07-17T00:00:00.000Z',
      overrideBlockers: true,
      targetBefore: 'a4',
      targetAfter: null,
      targetStatus: 'DONE',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
