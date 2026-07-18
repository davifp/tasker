import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { taskKeys } from '@/features/queryKeys';
import type { ChecklistItem } from '@/lib/http/types';

vi.mock('@/lib/http/checklists', () => ({
  checklistsHttp: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { checklistsHttp } from '@/lib/http/checklists';
import { useReorderChecklistItem, useToggleChecklistItem } from './useChecklistMutations';

const COORDS = { workspaceSlug: 'ws-1', projectSlug: 'p-1', taskNumber: 42 };

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'i-1',
    taskId: 't-1',
    title: 'Step one',
    checked: false,
    position: 'a0',
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useToggleChecklistItem', () => {
  it('flips checked in place, rolls back on error', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.checklist(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<ChecklistItem[]>(key, [makeItem()]);

    let reject: (err: Error) => void;
    vi.mocked(checklistsHttp.update).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof checklistsHttp.update>,
    );

    const { result } = renderHook(() => useToggleChecklistItem(COORDS), { wrapper });
    result.current.mutate({ itemId: 'i-1', checked: true });

    await waitFor(() => {
      expect(queryClient.getQueryData<ChecklistItem[]>(key)?.[0]?.checked).toBe(true);
    });
    reject!(new Error('boom'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<ChecklistItem[]>(key)?.[0]?.checked).toBe(false);
  });
});

describe('useReorderChecklistItem', () => {
  it('re-sorts by position after applying the patch', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const key = taskKeys.checklist(COORDS.workspaceSlug, COORDS.projectSlug, COORDS.taskNumber);
    queryClient.setQueryData<ChecklistItem[]>(key, [
      makeItem({ id: 'i-1', position: 'a1' }),
      makeItem({ id: 'i-2', position: 'a2' }),
      makeItem({ id: 'i-3', position: 'a3' }),
    ]);

    vi.mocked(checklistsHttp.update).mockResolvedValueOnce(makeItem({ id: 'i-3', position: 'a0' }));

    const { result } = renderHook(() => useReorderChecklistItem(COORDS), { wrapper });
    result.current.mutate({ itemId: 'i-3', position: 'a0' });

    await waitFor(() => {
      const arr = queryClient.getQueryData<ChecklistItem[]>(key);
      expect(arr?.map((i) => i.id)).toEqual(['i-3', 'i-1', 'i-2']);
    });
  });
});
