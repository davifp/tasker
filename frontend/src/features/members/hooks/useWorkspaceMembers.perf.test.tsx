import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';

vi.mock('@/lib/http/browser', () => ({
  browserHttp: {
    get: vi.fn(async () => [] as unknown),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { browserHttp } from '@/lib/http/browser';
import { useWorkspaceMembers } from './useWorkspaceMembers';

beforeEach(() => vi.clearAllMocks());

describe('useWorkspaceMembers — PERF-01', () => {
  it('fires exactly one fetch when two observers subscribe with the same slug', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const first = renderHook(() => useWorkspaceMembers('acme'), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useWorkspaceMembers('acme'), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(vi.mocked(browserHttp.get)).toHaveBeenCalledTimes(1);
  });

  it('keeps staleTime long enough that a normal drawer-open does not trigger a refetch', async () => {
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });

    const { result } = renderHook(() => useWorkspaceMembers('acme'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryCache().findAll({ queryKey: ['workspace-members', 'acme'] });
    expect(cached).toHaveLength(1);
    const observers = cached[0]!.observers;
    expect(observers).toHaveLength(1);
    expect(observers[0]!.options.staleTime).toBeGreaterThan(60 * 1000);
  });
});
