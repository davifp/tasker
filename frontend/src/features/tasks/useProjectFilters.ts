'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Priority, TaskStatus } from '@/lib/http/types';
import type {
  TaskFilters,
  TaskSortDir,
  TaskSortField,
} from '@/features/queryKeys';

// URL as source of truth for shareable filter state — extended for the
// alternative views (List, Backlog, Calendar, Timeline). The hook parses
// the current query, exposes typed getters, and writes back via
// router.replace so applying a filter never triggers a full navigation or
// scroll reset. Nothing depends on `nuqs`; the URL is the state
// container and `next/navigation` gives us all the primitives we need.

export type AssigneeFilter = 'me' | { userId: string } | null;

export type ProjectView =
  | 'board'
  | 'list'
  | 'backlog'
  | 'calendar'
  | 'timeline';

export interface ProjectFilters {
  view: ProjectView;
  assignee: AssigneeFilter;
  labels: string[];
  status: TaskStatus[];
  priority: Priority[];
  from: string | null;
  to: string | null;
  sort: TaskSortField | null;
  sortDir: TaskSortDir | null;
}

export interface ResolvedListFilters {
  assigneeUserId?: string;
  labelIds?: string[];
  status?: TaskStatus[];
  priority?: Priority[];
  from?: string;
  to?: string;
  sort?: TaskSortField;
  sortDir?: TaskSortDir;
}

const KEYS = {
  view: 'view',
  assignee: 'assignee',
  labels: 'labels',
  status: 'status',
  priority: 'priority',
  from: 'from',
  to: 'to',
  sort: 'sort',
  sortDir: 'sortDir',
} as const;

const ME_TOKEN = 'me';

const VIEWS: readonly ProjectView[] = ['board', 'list', 'backlog', 'calendar', 'timeline'];
const STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
];
const PRIORITIES: readonly Priority[] = ['LOW', 'MEDIUM', 'HIGH'];
const SORT_FIELDS: readonly TaskSortField[] = [
  'dueDate',
  'updatedAt',
  'priority',
  'title',
  'position',
];
const SORT_DIRS: readonly TaskSortDir[] = ['asc', 'desc'];

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  );
}

function parseEnumCsv<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  const parts = parseCsv(raw).map((part) => part.toUpperCase());
  return parts.filter((part): part is T => (allowed as readonly string[]).includes(part));
}

function parseView(raw: string | null): ProjectView {
  if (!raw) return 'board';
  const lowered = raw.toLowerCase();
  return (VIEWS as readonly string[]).includes(lowered) ? (lowered as ProjectView) : 'board';
}

function parseAssignee(raw: string | null): AssigneeFilter {
  if (raw === ME_TOKEN) return 'me';
  if (raw && raw.length > 0) return { userId: raw };
  return null;
}

function parseIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  // Accept both `YYYY-MM-DD` and full ISO datetimes so URLs stay short in
  // the common date-only case while a Timeline deep-link that pins to an
  // exact instant still round-trips.
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSort(raw: string | null): TaskSortField | null {
  if (!raw) return null;
  return (SORT_FIELDS as readonly string[]).includes(raw) ? (raw as TaskSortField) : null;
}

function parseSortDir(raw: string | null): TaskSortDir | null {
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  return (SORT_DIRS as readonly string[]).includes(lowered)
    ? (lowered as TaskSortDir)
    : null;
}

export function parseFiltersFromSearch(search: URLSearchParams): ProjectFilters {
  return {
    view: parseView(search.get(KEYS.view)),
    assignee: parseAssignee(search.get(KEYS.assignee)),
    labels: parseCsv(search.get(KEYS.labels)),
    status: parseEnumCsv<TaskStatus>(search.get(KEYS.status), STATUSES),
    priority: parseEnumCsv<Priority>(search.get(KEYS.priority), PRIORITIES),
    from: parseIsoDate(search.get(KEYS.from)),
    to: parseIsoDate(search.get(KEYS.to)),
    sort: parseSort(search.get(KEYS.sort)),
    sortDir: parseSortDir(search.get(KEYS.sortDir)),
  };
}

export function serializeFilters(filters: ProjectFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.view !== 'board') search.set(KEYS.view, filters.view);
  if (filters.assignee === 'me') {
    search.set(KEYS.assignee, ME_TOKEN);
  } else if (filters.assignee) {
    search.set(KEYS.assignee, filters.assignee.userId);
  }
  if (filters.labels.length > 0) search.set(KEYS.labels, filters.labels.join(','));
  if (filters.status.length > 0) search.set(KEYS.status, filters.status.join(','));
  if (filters.priority.length > 0) search.set(KEYS.priority, filters.priority.join(','));
  if (filters.from) search.set(KEYS.from, filters.from);
  if (filters.to) search.set(KEYS.to, filters.to);
  if (filters.sort) search.set(KEYS.sort, filters.sort);
  if (filters.sortDir) search.set(KEYS.sortDir, filters.sortDir);
  return search;
}

const EMPTY_FILTERS: ProjectFilters = {
  view: 'board',
  assignee: null,
  labels: [],
  status: [],
  priority: [],
  from: null,
  to: null,
  sort: null,
  sortDir: null,
};

export function makeEmptyFilters(): ProjectFilters {
  return { ...EMPTY_FILTERS, labels: [], status: [], priority: [] };
}

/**
 * Adapts the URL-first {@link ProjectFilters} shape to the transport-level
 * {@link ResolvedListFilters} the HTTP client accepts. The `assignee='me'`
 * token is resolved against the current user id here so views never leak
 * the special token to the API.
 */
export function resolveListFilters(
  filters: ProjectFilters,
  currentUserId: string,
): ResolvedListFilters {
  const out: ResolvedListFilters = {};
  const assigneeUserId =
    filters.assignee === 'me'
      ? currentUserId
      : filters.assignee
        ? filters.assignee.userId
        : undefined;
  if (assigneeUserId) out.assigneeUserId = assigneeUserId;
  if (filters.labels.length > 0) out.labelIds = filters.labels;
  if (filters.status.length > 0) out.status = filters.status;
  if (filters.priority.length > 0) out.priority = filters.priority;
  if (filters.from) out.from = filters.from;
  if (filters.to) out.to = filters.to;
  if (filters.sort) out.sort = filters.sort;
  if (filters.sortDir) out.sortDir = filters.sortDir;
  return out;
}

/**
 * Builds the {@link TaskFilters} shape suitable for `taskKeys.list`. Same
 * data as {@link ResolvedListFilters}, but typed against the cache-key
 * contract (which requires the `'me'` token to be resolved upstream).
 */
export function toTaskFilters(
  filters: ProjectFilters,
  currentUserId: string,
): TaskFilters {
  const resolved = resolveListFilters(filters, currentUserId);
  const out: TaskFilters = {};
  if (resolved.assigneeUserId) out.assigneeUserId = resolved.assigneeUserId;
  if (resolved.labelIds) out.labelIds = resolved.labelIds;
  if (resolved.status) out.status = resolved.status;
  if (resolved.priority) out.priority = resolved.priority;
  if (resolved.from) out.from = resolved.from;
  if (resolved.to) out.to = resolved.to;
  if (resolved.sort) out.sort = resolved.sort;
  if (resolved.sortDir) out.sortDir = resolved.sortDir;
  return out;
}

export interface UseProjectFiltersResult {
  filters: ProjectFilters;
  setView(value: ProjectView): void;
  setAssignee(value: AssigneeFilter): void;
  setLabels(next: string[]): void;
  toggleLabel(id: string): void;
  setStatus(next: TaskStatus[]): void;
  setPriority(next: Priority[]): void;
  setDateRange(range: { from: string | null; to: string | null }): void;
  setSort(sort: TaskSortField | null, dir?: TaskSortDir | null): void;
  clear(): void;
  isEmpty: boolean;
}

const MANAGED_KEYS: readonly string[] = Object.values(KEYS);

export function useProjectFilters(): UseProjectFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFiltersFromSearch(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams],
  );

  const replace = useCallback(
    (next: ProjectFilters) => {
      // Preserve unrelated query params — a filter apply must not stomp
      // pagination or drawer-related state a peer feature might add later.
      const current = new URLSearchParams(searchParams?.toString() ?? '');
      for (const key of MANAGED_KEYS) current.delete(key);
      const patch = serializeFilters(next);
      for (const [key, value] of patch.entries()) current.set(key, value);
      const query = current.toString();
      router.replace(query ? `${pathname}?${query}` : (pathname ?? '/'), { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setView = useCallback(
    (value: ProjectView) => replace({ ...filters, view: value }),
    [filters, replace],
  );

  const setAssignee = useCallback(
    (value: AssigneeFilter) => replace({ ...filters, assignee: value }),
    [filters, replace],
  );

  const setLabels = useCallback(
    (next: string[]) =>
      replace({
        ...filters,
        labels: Array.from(new Set(next.filter((id) => id.length > 0))),
      }),
    [filters, replace],
  );

  const toggleLabel = useCallback(
    (id: string) => {
      const has = filters.labels.includes(id);
      const next = has
        ? filters.labels.filter((existing) => existing !== id)
        : [...filters.labels, id];
      replace({ ...filters, labels: next });
    },
    [filters, replace],
  );

  const setStatus = useCallback(
    (next: TaskStatus[]) => replace({ ...filters, status: [...next] }),
    [filters, replace],
  );

  const setPriority = useCallback(
    (next: Priority[]) => replace({ ...filters, priority: [...next] }),
    [filters, replace],
  );

  const setDateRange = useCallback(
    (range: { from: string | null; to: string | null }) =>
      replace({ ...filters, from: range.from, to: range.to }),
    [filters, replace],
  );

  const setSort = useCallback(
    (sort: TaskSortField | null, dir: TaskSortDir | null = null) =>
      replace({ ...filters, sort, sortDir: sort ? (dir ?? 'asc') : null }),
    [filters, replace],
  );

  const clear = useCallback(() => replace({ ...makeEmptyFilters(), view: filters.view }), [
    filters.view,
    replace,
  ]);

  const isEmpty =
    filters.assignee === null &&
    filters.labels.length === 0 &&
    filters.status.length === 0 &&
    filters.priority.length === 0 &&
    filters.from === null &&
    filters.to === null &&
    filters.sort === null;

  return {
    filters,
    setView,
    setAssignee,
    setLabels,
    toggleLabel,
    setStatus,
    setPriority,
    setDateRange,
    setSort,
    clear,
    isEmpty,
  };
}
