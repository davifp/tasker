import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { Comment } from '@/lib/http/types';

vi.mock('@/lib/http/comments', () => ({
  commentsHttp: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { commentsHttp } from '@/lib/http/comments';
import { useAddComment, useDeleteComment, useEditComment } from './useCommentMutations';

const COORDS = { workspaceSlug: 'ws-1', projectSlug: 'p-1', taskNumber: 42 };

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    workspaceId: 'ws-1',
    taskId: 't-1',
    authorUserId: 'u-1',
    body: 'hello',
    deletedAt: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useAddComment', () => {
  it('appends an optimistic entry, rolls back on error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.comments(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<Comment[]>(key, [makeComment()]);

    let reject: (err: Error) => void;
    vi.mocked(commentsHttp.create).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof commentsHttp.create>,
    );

    const { result } = renderHook(() => useAddComment(COORDS), { wrapper });
    result.current.mutate({ body: 'new', authorUserId: 'u-1' });

    await waitFor(() => {
      expect(queryClient.getQueryData<Comment[]>(key)).toHaveLength(2);
    });

    reject!(new Error('boom'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Comment[]>(key)).toHaveLength(1);
  });
});

describe('useEditComment', () => {
  it('patches the body in place', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.comments(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<Comment[]>(key, [makeComment()]);

    vi.mocked(commentsHttp.update).mockResolvedValueOnce(makeComment({ body: 'edited' }));

    const { result } = renderHook(() => useEditComment(COORDS), { wrapper });
    result.current.mutate({ id: 'c-1', body: 'edited' });

    await waitFor(() => {
      expect(queryClient.getQueryData<Comment[]>(key)?.[0]?.body).toBe('edited');
    });
  });
});

describe('useDeleteComment', () => {
  it('drops the row on optimistic apply', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.comments(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<Comment[]>(key, [makeComment(), makeComment({ id: 'c-2' })]);

    vi.mocked(commentsHttp.remove).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteComment(COORDS), { wrapper });
    result.current.mutate({ id: 'c-1' });

    await waitFor(() => {
      expect(queryClient.getQueryData<Comment[]>(key)).toHaveLength(1);
    });
    expect(queryClient.getQueryData<Comment[]>(key)?.[0]?.id).toBe('c-2');
  });
});
