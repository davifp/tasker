import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import { HttpError } from '@/lib/http/errors';
import type { TaskDependency } from '@/lib/http/types';

vi.mock('@/lib/http/dependencies', () => ({
  dependenciesHttp: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

import { dependenciesHttp } from '@/lib/http/dependencies';
import { useAddDependency, useRemoveDependency } from './useDependencies';

const COORDS = { workspaceSlug: 'ws-1', projectSlug: 'p-1', taskNumber: 42 };

beforeEach(() => vi.clearAllMocks());

describe('useAddDependency', () => {
  it('rolls back on 409 dependency-cycle so the drawer badge does not flash', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.dependencies(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    const seed: TaskDependency[] = [{ taskId: 't-1', blockedByTaskId: 't-existing' }];
    queryClient.setQueryData<TaskDependency[]>(key, seed);

    let reject: (err: unknown) => void;
    vi.mocked(dependenciesHttp.add).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof dependenciesHttp.add>,
    );

    const { result } = renderHook(() => useAddDependency(COORDS), { wrapper });
    result.current.mutate({ blockedByTaskId: 't-new' });

    await waitFor(() => {
      expect(queryClient.getQueryData<TaskDependency[]>(key)).toHaveLength(2);
    });
    reject!(
      new HttpError({
        type: 'https://tasker.dev/problems/dependency-cycle',
        title: 'Cycle',
        status: 409,
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<TaskDependency[]>(key)).toEqual(seed);
  });
});

describe('useRemoveDependency', () => {
  it('drops the edge on optimistic apply', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.dependencies(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<TaskDependency[]>(key, [
      { taskId: 't-1', blockedByTaskId: 't-a' },
      { taskId: 't-1', blockedByTaskId: 't-b' },
    ]);

    vi.mocked(dependenciesHttp.remove).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRemoveDependency(COORDS), { wrapper });
    result.current.mutate({ blockerId: 't-a' });

    await waitFor(() => {
      expect(queryClient.getQueryData<TaskDependency[]>(key)).toEqual([
        { taskId: 't-1', blockedByTaskId: 't-b' },
      ]);
    });
  });
});
