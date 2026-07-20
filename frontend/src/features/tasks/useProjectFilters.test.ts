import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  parseFiltersFromSearch,
  resolveListFilters,
  serializeFilters,
  toTaskFilters,
  useProjectFilters,
  makeEmptyFilters,
  type ProjectFilters,
} from './useProjectFilters';

const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ws/projects/p/board',
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
}));

describe('useProjectFilters — parse (referential contract)', () => {
  it('returns an equal-value object for equal query strings across calls', () => {
    const a = parseFiltersFromSearch(new URLSearchParams('assignee=me&labels=x,y'));
    const b = parseFiltersFromSearch(new URLSearchParams('assignee=me&labels=x,y'));
    expect(a).toEqual(b);
  });
});

describe('useProjectFilters — parse', () => {
  it('returns board view + empty filters for an empty query', () => {
    const result = parseFiltersFromSearch(new URLSearchParams(''));
    expect(result).toEqual(makeEmptyFilters());
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

  it('parses view when present and defaults to board otherwise', () => {
    expect(parseFiltersFromSearch(new URLSearchParams('view=list')).view).toBe('list');
    expect(parseFiltersFromSearch(new URLSearchParams('view=bogus')).view).toBe('board');
    expect(parseFiltersFromSearch(new URLSearchParams('')).view).toBe('board');
  });

  it('parses status + priority CSV, uppercases inputs, drops unknowns', () => {
    const result = parseFiltersFromSearch(
      new URLSearchParams('status=todo,IN_PROGRESS,nope&priority=high,low,bogus'),
    );
    expect(result.status).toEqual(['TODO', 'IN_PROGRESS']);
    expect(result.priority).toEqual(['HIGH', 'LOW']);
  });

  it('parses from/to as ISO strings straight through', () => {
    const result = parseFiltersFromSearch(
      new URLSearchParams('from=2026-01-01&to=2026-02-01'),
    );
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-02-01');
  });

  it('parses sort + sortDir when valid', () => {
    const result = parseFiltersFromSearch(
      new URLSearchParams('sort=dueDate&sortDir=DESC'),
    );
    expect(result.sort).toBe('dueDate');
    expect(result.sortDir).toBe('desc');
  });
});

describe('useProjectFilters — serialize', () => {
  it('round-trips through parse for the "me" case', () => {
    const before: ProjectFilters = { ...makeEmptyFilters(), assignee: 'me', labels: ['a', 'b'] };
    const params = serializeFilters(before);
    const after = parseFiltersFromSearch(new URLSearchParams(params.toString()));
    expect(after).toEqual(before);
  });

  it('round-trips a userId assignee', () => {
    const before: ProjectFilters = { ...makeEmptyFilters(), assignee: { userId: 'u-1' } };
    const after = parseFiltersFromSearch(new URLSearchParams(serializeFilters(before).toString()));
    expect(after).toEqual(before);
  });

  it('omits keys when the filters are empty (view=board is the default)', () => {
    const s = serializeFilters(makeEmptyFilters());
    expect(s.toString()).toBe('');
  });

  it('round-trips every new param', () => {
    const before: ProjectFilters = {
      view: 'timeline',
      assignee: 'me',
      labels: ['a', 'b'],
      status: ['TODO', 'IN_PROGRESS'],
      priority: ['HIGH'],
      from: '2026-01-01',
      to: '2026-02-01',
      sort: 'dueDate',
      sortDir: 'desc',
    };
    const params = serializeFilters(before);
    const after = parseFiltersFromSearch(new URLSearchParams(params.toString()));
    expect(after).toEqual(before);
  });
});

describe('useProjectFilters — hook wiring', () => {
  it('setAssignee(me) issues a router.replace including assignee=me', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.setAssignee('me'));
    expect(routerReplace).toHaveBeenCalledTimes(1);
    const [urlArg, opts] = routerReplace.mock.calls[0] as [string, { scroll: boolean }];
    expect(urlArg).toBe('/ws/projects/p/board?assignee=me');
    expect(opts.scroll).toBe(false);
  });

  it('toggleLabel appends to and removes the label id from the URL', () => {
    routerReplace.mockClear();
    mockSearchParams.current = 'assignee=me';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.toggleLabel('lbl-1'));
    const first = routerReplace.mock.calls[0]?.[0] as string;
    expect(first).toContain('assignee=me');
    expect(first).toContain('labels=lbl-1');
  });

  it('clear() drops filter keys but keeps unrelated query params and current view', () => {
    routerReplace.mockClear();
    mockSearchParams.current = 'view=list&assignee=me&labels=a&other=keep';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.clear());
    const url = routerReplace.mock.calls[0]?.[0] as string;
    // view=list preserved; assignee/labels dropped; unrelated `other=keep` stays.
    expect(url).toContain('view=list');
    expect(url).toContain('other=keep');
    expect(url).not.toContain('assignee=');
    expect(url).not.toContain('labels=');
  });

  it('setView writes view= to the URL when non-default', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.setView('list'));
    const url = routerReplace.mock.calls[0]?.[0] as string;
    expect(url).toBe('/ws/projects/p/board?view=list');
  });

  it('setSort writes both sort and sortDir', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.setSort('dueDate', 'desc'));
    const url = routerReplace.mock.calls[0]?.[0] as string;
    expect(url).toContain('sort=dueDate');
    expect(url).toContain('sortDir=desc');
  });

  it('setDateRange writes from and to; nulls remove them', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.setDateRange({ from: '2026-01-01', to: '2026-02-01' }));
    const url = routerReplace.mock.calls[0]?.[0] as string;
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-02-01');
  });

  it('setStatus + setPriority write CSV values', () => {
    routerReplace.mockClear();
    mockSearchParams.current = '';
    const { result } = renderHook(() => useProjectFilters());
    act(() => result.current.setStatus(['TODO', 'IN_PROGRESS']));
    const url1 = routerReplace.mock.calls[0]?.[0] as string;
    expect(url1).toContain('status=TODO%2CIN_PROGRESS');

    mockSearchParams.current = 'status=TODO,IN_PROGRESS';
    const { result: result2 } = renderHook(() => useProjectFilters());
    act(() => result2.current.setPriority(['HIGH']));
    const url2 = routerReplace.mock.calls[1]?.[0] as string;
    expect(url2).toContain('priority=HIGH');
    expect(url2).toContain('status=TODO%2CIN_PROGRESS');
  });
});

describe('useProjectFilters — resolveListFilters', () => {
  it('translates "me" to the current userId', () => {
    const resolved = resolveListFilters(
      { ...makeEmptyFilters(), assignee: 'me' },
      'user-99',
    );
    expect(resolved).toEqual({ assigneeUserId: 'user-99' });
  });

  it('passes an explicit userId straight through', () => {
    const resolved = resolveListFilters(
      { ...makeEmptyFilters(), assignee: { userId: 'other' } },
      'user-99',
    );
    expect(resolved).toEqual({ assigneeUserId: 'other' });
  });

  it('emits labelIds only when there is at least one label', () => {
    const withLabels = resolveListFilters(
      { ...makeEmptyFilters(), labels: ['a'] },
      'me',
    );
    expect(withLabels).toEqual({ labelIds: ['a'] });
    const empty = resolveListFilters(makeEmptyFilters(), 'me');
    expect(empty).toEqual({});
  });

  it('includes status/priority/from/to/sort when present', () => {
    const resolved = resolveListFilters(
      {
        ...makeEmptyFilters(),
        status: ['TODO'],
        priority: ['HIGH'],
        from: '2026-01-01',
        to: '2026-02-01',
        sort: 'dueDate',
        sortDir: 'desc',
      },
      'me',
    );
    expect(resolved).toEqual({
      status: ['TODO'],
      priority: ['HIGH'],
      from: '2026-01-01',
      to: '2026-02-01',
      sort: 'dueDate',
      sortDir: 'desc',
    });
  });
});

describe('useProjectFilters — toTaskFilters', () => {
  it('returns an empty object for the empty filter set', () => {
    expect(toTaskFilters(makeEmptyFilters(), 'me')).toEqual({});
  });

  it('resolves the me token before handing off to the cache-key layer', () => {
    expect(
      toTaskFilters({ ...makeEmptyFilters(), assignee: 'me' }, 'user-99'),
    ).toEqual({ assigneeUserId: 'user-99' });
  });
});
