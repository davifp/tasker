import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { searchQueryKey, useDebounced } from './useSearchQuery';

describe('searchQueryKey', () => {
  it('yields identical keys regardless of type-array ordering', () => {
    const a = searchQueryKey('ws', { q: 'x', type: ['task', 'project'] });
    const b = searchQueryKey('ws', { q: 'x', type: ['project', 'task'] });
    expect(a).toEqual(b);
  });

  it('differs when workspace slug differs', () => {
    const a = searchQueryKey('ws1', { q: 'x' });
    const b = searchQueryKey('ws2', { q: 'x' });
    expect(a).not.toEqual(b);
  });

  it('omits undefined optional filters', () => {
    const [, , normalized] = searchQueryKey('ws', { q: 'foo' }) as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(normalized).toEqual({ q: 'foo' });
  });
});

describe('useDebounced', () => {
  it('returns the initial value synchronously', () => {
    const { result } = renderHook(() => useDebounced('initial', 50));
    expect(result.current).toBe('initial');
  });

  it('updates only after the delay elapses', async () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounced(v, 30), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    expect(result.current).toBe('a');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current).toBe('b');
  });
});
