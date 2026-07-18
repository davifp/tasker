import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { labelKeys } from '@/features/queryKeys';
import type { CursorPage, Label } from '@/lib/http/types';

vi.mock('@/lib/http/labels', () => ({
  labelsHttp: {
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { labelsHttp } from '@/lib/http/labels';
import { useDeleteLabel, useUpdateLabel } from './useLabelMutations';

const WS = 'ws-1';

function makeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: 'l-1',
    workspaceId: WS,
    name: 'bug',
    color: '#ef4444',
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useUpdateLabel', () => {
  it('patches list optimistically and rolls back on error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const listKey = labelKeys.list(WS);
    queryClient.setQueryData<CursorPage<Label>>(listKey, {
      items: [makeLabel()],
      nextCursor: null,
    });

    // Hold the mock in flight so waitFor can catch the optimistic write
    // before the rejection triggers the rollback.
    let reject: (err: Error) => void;
    vi.mocked(labelsHttp.update).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof labelsHttp.update>,
    );

    const { result } = renderHook(() => useUpdateLabel(WS), { wrapper });
    result.current.mutate({ id: 'l-1', patch: { name: 'renamed' } });

    await waitFor(() => {
      expect(queryClient.getQueryData<CursorPage<Label>>(listKey)?.items[0]?.name).toBe('renamed');
    });

    reject!(new Error('boom'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<CursorPage<Label>>(listKey)?.items[0]?.name).toBe('bug');
  });
});

describe('useDeleteLabel', () => {
  it('drops the label from the list immediately', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const listKey = labelKeys.list(WS);
    queryClient.setQueryData<CursorPage<Label>>(listKey, {
      items: [makeLabel(), makeLabel({ id: 'l-2', name: 'chore' })],
      nextCursor: null,
    });

    vi.mocked(labelsHttp.remove).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteLabel(WS), { wrapper });
    result.current.mutate({ id: 'l-1' });

    await waitFor(() => {
      expect(queryClient.getQueryData<CursorPage<Label>>(listKey)?.items).toHaveLength(1);
    });
    expect(queryClient.getQueryData<CursorPage<Label>>(listKey)?.items[0]?.id).toBe('l-2');
  });
});
