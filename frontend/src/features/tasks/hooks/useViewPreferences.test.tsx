import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';

vi.mock('@/lib/http/viewPreferences', () => ({
  viewPreferencesHttp: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { viewPreferencesHttp } from '@/lib/http/viewPreferences';
import { toast } from 'sonner';
import { useViewPreferences } from './useViewPreferences';

const WS = 'ws-1';
const PROJ = 'p-1';

// Drains pending microtasks + advances fake timers by `ms`. Needed
// because we run the whole hook under fake timers so the debounce
// window can be advanced deterministically; a React re-render triggered
// by TanStack Query's async fetch still needs microtasks to flush.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useViewPreferences', () => {
  it('coalesces three rapid `.set()` calls into a single PUT', async () => {
    vi.mocked(viewPreferencesHttp.get).mockResolvedValue({});
    vi.mocked(viewPreferencesHttp.update).mockImplementation(async (_ws, _p, patch) => patch);

    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const { result } = renderHook(() => useViewPreferences(WS, PROJ), { wrapper });

    await flush();

    act(() => {
      result.current.set({ list: { columns: ['a'], hidden: [], sort: { by: 'title', dir: 'asc' } } });
      result.current.set({ list: { columns: ['a', 'b'], hidden: [], sort: { by: 'title', dir: 'asc' } } });
      result.current.set({ list: { columns: ['a', 'b', 'c'], hidden: [], sort: { by: 'title', dir: 'asc' } } });
    });

    expect(viewPreferencesHttp.update).not.toHaveBeenCalled();

    await flush(400);

    expect(viewPreferencesHttp.update).toHaveBeenCalledTimes(1);
    const [, , payload] = vi.mocked(viewPreferencesHttp.update).mock.calls[0]!;
    expect(payload).toEqual({
      list: { columns: ['a', 'b', 'c'], hidden: [], sort: { by: 'title', dir: 'asc' } },
    });
  });

  it('applies patches optimistically before the debounced PUT fires', async () => {
    vi.mocked(viewPreferencesHttp.get).mockResolvedValue({ defaultView: 'board' });
    vi.mocked(viewPreferencesHttp.update).mockImplementation(async () => ({}));

    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const { result } = renderHook(() => useViewPreferences(WS, PROJ), { wrapper });

    await flush();
    expect(result.current.preferences.defaultView).toBe('board');

    act(() => {
      result.current.set({ defaultView: 'timeline' });
    });
    await flush();

    expect(result.current.preferences.defaultView).toBe('timeline');
    expect(viewPreferencesHttp.update).not.toHaveBeenCalled();
  });

  it('reverts the cache and shows a toast on server error', async () => {
    vi.mocked(viewPreferencesHttp.get).mockResolvedValue({ defaultView: 'board' });
    vi.mocked(viewPreferencesHttp.update).mockRejectedValue(new Error('boom'));

    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const { result } = renderHook(() => useViewPreferences(WS, PROJ), { wrapper });

    await flush();
    expect(result.current.preferences.defaultView).toBe('board');

    act(() => {
      result.current.set({ defaultView: 'timeline' });
    });

    await flush(400);

    expect(result.current.preferences.defaultView).toBe('board');
    expect(toast.error).toHaveBeenCalledWith('errorSave');
  });

  it('does not fire a PUT before the debounce window elapses', async () => {
    vi.mocked(viewPreferencesHttp.get).mockResolvedValue({});
    vi.mocked(viewPreferencesHttp.update).mockResolvedValue({});

    const queryClient = makeQueryClient();
    const wrapper = makeWrapper({ queryClient });
    const { result } = renderHook(() => useViewPreferences(WS, PROJ), { wrapper });

    await flush();

    act(() => {
      result.current.set({ defaultView: 'list' });
    });

    await flush(100);
    expect(viewPreferencesHttp.update).not.toHaveBeenCalled();

    await flush(300);
    expect(viewPreferencesHttp.update).toHaveBeenCalledTimes(1);
  });
});
