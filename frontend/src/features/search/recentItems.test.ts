import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentItems } from './recentItems';

describe('useRecentItems', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useRecentItems('ws'));
    expect(result.current.items).toEqual([]);
  });

  it('caps items at 8 per workspace', () => {
    const { result } = renderHook(() => useRecentItems('ws'));
    act(() => {
      for (let i = 0; i < 12; i++) {
        result.current.push({
          type: 'task',
          id: `t-${i}`,
          label: `Task ${i}`,
          url: `/ws/tasks/${i}`,
        });
      }
    });
    expect(result.current.items).toHaveLength(8);
    // Most recent first
    expect(result.current.items[0]?.id).toBe('t-11');
  });

  it('deduplicates on push by url', () => {
    const { result } = renderHook(() => useRecentItems('ws'));
    act(() => {
      result.current.push({ type: 'task', id: 't-1', label: 'A', url: '/x' });
      result.current.push({ type: 'task', id: 't-2', label: 'B', url: '/y' });
      result.current.push({ type: 'task', id: 't-1', label: 'A', url: '/x' });
    });
    expect(result.current.items.map((i) => i.url)).toEqual(['/x', '/y']);
  });

  it('respects workspace boundary', () => {
    const { result: a } = renderHook(() => useRecentItems('wa'));
    act(() => {
      a.current.push({ type: 'task', id: 't', label: 'A', url: '/a' });
    });
    const { result: b } = renderHook(() => useRecentItems('wb'));
    expect(b.current.items).toEqual([]);
  });
});
