import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  parseFiltersFromSearch,
  resolveListFilters,
  serializeFilters,
  useBoardFilters,
  type BoardFilters,
} from './useBoardFilters';

const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ws/projects/p/board',
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
}));

describe('useBoardFilters — parse (referential contract)', () => {
  it('returns an equal-value object for equal query strings across calls', () => {
    const a = parseFiltersFromSearch(new URLSearchParams('assignee=me&labels=x,y'));
    const b = parseFiltersFromSearch(new URLSearchParams('assignee=me&labels=x,y'));
    expect(a).toEqual(b);
  });
});

describe('useBoardFilters — parse', () => {
  it('returns null assignee and empty labels for an empty query', () => {
    const result = parseFiltersFromSearch(new URLSearchParams(''));
    expect(result).toEqual({ assignee: null, labels: [] });
  });

  it('recognizes the "me" assignee token', () => {
    const result = parseFiltersFromSearch(new URLSearchParams('assignee=me'));
    expect(result.assignee).toBe('me');
  });

  it('parses an explicit userId as an object', () => {
    const result = parseFiltersFromSearch(new URLSearchParams('assignee=user-42'));
    expect(result.assignee).toEqual({ userId: 'user-42' });
  });

  it('parses a comma-separated labels list, drops empties and dedupes', () => {
    const result = parseFiltersFromSearch(
      new URLSearchParams('labels=lbl-a,,lbl-b, ,lbl-a'),
    );
    expect(result.labels).toEqual(['lbl-a', 'lbl-b']);
  });
});

describe('useBoardFilters — serialize', () => {
  it('round-trips through parse for the "me" case', () => {
    const before: BoardFilters = { assignee: 'me', labels: ['a', 'b'] };
    const params = serializeFilters(before);
    const after = parseFiltersFromSearch(new URLSearchParams(params.toString()));
    expect(after).toEqual(before);
  });

  it('round-trips a userId assignee', () => {
    const before: BoardFilters = { assignee: { userId: 'u-1' }, labels: [] };
    const after = parseFiltersFromSearch(new URLSearchParams(serializeFilters(before).toString()));
    expect(after).toEqual(before);
  });

  it('omits keys when the filters are empty', () => {
    const s = serializeFilters({ assignee: null, labels: [] });
    expect(s.toString()).toBe('');
  });
});

describe('useBoardFilters — hook wiring', () => {
  it('setAssignee(me) issues a router.replace including assignee=me', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useBoardFilters());
    act(() => result.current.setAssignee('me'));
    expect(routerReplace).toHaveBeenCalledTimes(1);
    const [urlArg, opts] = routerReplace.mock.calls[0] as [string, { scroll: boolean }];
    expect(urlArg).toBe('/ws/projects/p/board?assignee=me');
    expect(opts.scroll).toBe(false);
  });

  it('toggleLabel appends to and removes the label id from the URL', () => {
    routerReplace.mockClear();
    mockSearchParams.current = 'assignee=me';
    const { result } = renderHook(() => useBoardFilters());
    act(() => result.current.toggleLabel('lbl-1'));
    const first = routerReplace.mock.calls[0]?.[0] as string;
    expect(first).toContain('assignee=me');
    expect(first).toContain('labels=lbl-1');
  });

  it('clear() drops both filter keys but keeps unrelated query params', () => {
    routerReplace.mockClear();
    mockSearchParams.current = 'assignee=me&labels=a&other=keep';
    const { result } = renderHook(() => useBoardFilters());
    act(() => result.current.clear());
    const url = routerReplace.mock.calls[0]?.[0] as string;
    expect(url).toBe('/ws/projects/p/board?other=keep');
  });
});

describe('useBoardFilters — resolveListFilters', () => {
  it('translates "me" to the current userId', () => {
    const resolved = resolveListFilters({ assignee: 'me', labels: [] }, 'user-99');
    expect(resolved).toEqual({ assigneeUserId: 'user-99' });
  });

  it('passes an explicit userId straight through', () => {
    const resolved = resolveListFilters({ assignee: { userId: 'other' }, labels: [] }, 'user-99');
    expect(resolved).toEqual({ assigneeUserId: 'other' });
  });

  it('emits labelIds only when there is at least one label', () => {
    const with_labels = resolveListFilters({ assignee: null, labels: ['a'] }, 'me');
    expect(with_labels).toEqual({ labelIds: ['a'] });
    const empty = resolveListFilters({ assignee: null, labels: [] }, 'me');
    expect(empty).toEqual({});
  });
});
