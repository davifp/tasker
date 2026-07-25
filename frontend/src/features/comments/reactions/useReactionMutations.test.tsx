import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { ReactionSummary } from '@/lib/http/types';

vi.mock('@/lib/http/reactions', () => ({
  reactionsHttp: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

import { reactionsHttp } from '@/lib/http/reactions';
import { useToggleReaction } from './useReactionMutations';

const COORDS = {
  workspaceSlug: 'ws',
  projectSlug: 'p',
  taskNumber: 42,
  commentId: 'c-1',
  currentUserId: 'u-me',
  currentUserDisplayName: 'Me',
};

const KEY = taskKeys.reactions(
  COORDS.workspaceSlug,
  COORDS.projectSlug,
  COORDS.taskNumber,
  COORDS.commentId,
);

beforeEach(() => vi.clearAllMocks());

describe('useToggleReaction — optimistic add', () => {
  it('creates a fresh summary row when the user is the first reactor', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    queryClient.setQueryData<ReactionSummary[]>(KEY, []);
    vi.mocked(reactionsHttp.add).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: true });

    await waitFor(() => {
      const rows = queryClient.getQueryData<ReactionSummary[]>(KEY) ?? [];
      expect(rows.find((r) => r.emoji === 'heart')?.count).toBe(1);
    });
    const row = queryClient.getQueryData<ReactionSummary[]>(KEY)!.find((r) => r.emoji === 'heart')!;
    expect(row.reactedByMe).toBe(true);
    expect(row.reactorSample[0]?.userId).toBe('u-me');
  });

  it('increments an existing count and flips reactedByMe when the user joins', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    queryClient.setQueryData<ReactionSummary[]>(KEY, [
      {
        emoji: 'heart',
        count: 2,
        reactedByMe: false,
        reactorSample: [
          { userId: 'u-a', displayName: 'A' },
          { userId: 'u-b', displayName: 'B' },
        ],
      },
    ]);
    vi.mocked(reactionsHttp.add).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: true });

    await waitFor(() => {
      const row = queryClient
        .getQueryData<ReactionSummary[]>(KEY)!
        .find((r) => r.emoji === 'heart')!;
      expect(row.count).toBe(3);
      expect(row.reactedByMe).toBe(true);
    });
  });

  it('is a no-op when the user already reacted', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    queryClient.setQueryData<ReactionSummary[]>(KEY, [
      {
        emoji: 'heart',
        count: 1,
        reactedByMe: true,
        reactorSample: [{ userId: 'u-me', displayName: 'Me' }],
      },
    ]);
    vi.mocked(reactionsHttp.add).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: true });

    await waitFor(() => expect(reactionsHttp.add).toHaveBeenCalled());
    const row = queryClient.getQueryData<ReactionSummary[]>(KEY)!.find((r) => r.emoji === 'heart')!;
    expect(row.count).toBe(1);
  });
});

describe('useToggleReaction — optimistic remove', () => {
  it('decrements the count, drops reactedByMe, filters the user from sample', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    queryClient.setQueryData<ReactionSummary[]>(KEY, [
      {
        emoji: 'heart',
        count: 2,
        reactedByMe: true,
        reactorSample: [
          { userId: 'u-me', displayName: 'Me' },
          { userId: 'u-b', displayName: 'B' },
        ],
      },
    ]);
    vi.mocked(reactionsHttp.remove).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: false });

    await waitFor(() => {
      const row = queryClient
        .getQueryData<ReactionSummary[]>(KEY)!
        .find((r) => r.emoji === 'heart')!;
      expect(row.count).toBe(1);
      expect(row.reactedByMe).toBe(false);
      expect(row.reactorSample.map((r) => r.userId)).not.toContain('u-me');
    });
  });

  it('drops the row entirely when the count reaches zero', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    queryClient.setQueryData<ReactionSummary[]>(KEY, [
      {
        emoji: 'heart',
        count: 1,
        reactedByMe: true,
        reactorSample: [{ userId: 'u-me', displayName: 'Me' }],
      },
    ]);
    vi.mocked(reactionsHttp.remove).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: false });

    await waitFor(() => {
      const rows = queryClient.getQueryData<ReactionSummary[]>(KEY) ?? [];
      expect(rows.find((r) => r.emoji === 'heart')).toBeUndefined();
    });
  });
});

describe('useToggleReaction — error rollback', () => {
  it('restores the previous snapshot when the HTTP call fails', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const initial: ReactionSummary[] = [];
    queryClient.setQueryData<ReactionSummary[]>(KEY, initial);
    let reject: (err: Error) => void;
    vi.mocked(reactionsHttp.add).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof reactionsHttp.add>,
    );

    const { result } = renderHook(() => useToggleReaction(COORDS), { wrapper });
    result.current.mutate({ emoji: 'heart', add: true });

    await waitFor(() => {
      expect(queryClient.getQueryData<ReactionSummary[]>(KEY)?.length).toBe(1);
    });

    reject!(new Error('boom'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<ReactionSummary[]>(KEY)).toEqual(initial);
  });
});
