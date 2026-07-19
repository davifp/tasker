'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// URL as source of truth for shareable filter state. The hook parses the
// current query, exposes typed getters, and writes back via router.replace
// so applying a filter never triggers a full navigation or scroll reset.

export type AssigneeFilter = 'me' | { userId: string } | null;

export interface BoardFilters {
  assignee: AssigneeFilter;
  labels: string[];
}

export interface ResolvedListFilters {
  assigneeUserId?: string;
  labelIds?: string[];
}

const ASSIGNEE_KEY = 'assignee';
const LABELS_KEY = 'labels';
const ME_TOKEN = 'me';

export function parseFiltersFromSearch(search: URLSearchParams): BoardFilters {
  const rawAssignee = search.get(ASSIGNEE_KEY);
  const assignee: AssigneeFilter =
    rawAssignee === ME_TOKEN
      ? 'me'
      : rawAssignee && rawAssignee.length > 0
        ? { userId: rawAssignee }
        : null;

  const rawLabels = search.get(LABELS_KEY);
  const labels = rawLabels
    ? Array.from(
        new Set(
          rawLabels
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
        ),
      )
    : [];

  return { assignee, labels };
}

export function serializeFilters(filters: BoardFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.assignee === 'me') {
    search.set(ASSIGNEE_KEY, ME_TOKEN);
  } else if (filters.assignee) {
    search.set(ASSIGNEE_KEY, filters.assignee.userId);
  }
  if (filters.labels.length > 0) {
    search.set(LABELS_KEY, filters.labels.join(','));
  }
  return search;
}

export function resolveListFilters(
  filters: BoardFilters,
  currentUserId: string,
): ResolvedListFilters {
  const assigneeUserId =
    filters.assignee === 'me'
      ? currentUserId
      : filters.assignee
        ? filters.assignee.userId
        : undefined;
  return {
    ...(assigneeUserId ? { assigneeUserId } : {}),
    ...(filters.labels.length > 0 ? { labelIds: filters.labels } : {}),
  };
}

export interface UseBoardFiltersResult {
  filters: BoardFilters;
  setAssignee(value: AssigneeFilter): void;
  setLabels(next: string[]): void;
  toggleLabel(id: string): void;
  clear(): void;
  isEmpty: boolean;
}

export function useBoardFilters(): UseBoardFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFiltersFromSearch(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams],
  );

  const replace = useCallback(
    (next: BoardFilters) => {
      // Preserve unrelated query params — a filter apply must not stomp
      // pagination or drawer-related state a peer feature might add later.
      const current = new URLSearchParams(searchParams?.toString() ?? '');
      current.delete(ASSIGNEE_KEY);
      current.delete(LABELS_KEY);
      const patch = serializeFilters(next);
      for (const [key, value] of patch.entries()) current.set(key, value);
      const query = current.toString();
      router.replace(query ? `${pathname}?${query}` : (pathname ?? '/'), { scroll: false });
    },
    [pathname, router, searchParams],
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
      const next = has ? filters.labels.filter((existing) => existing !== id) : [...filters.labels, id];
      replace({ ...filters, labels: next });
    },
    [filters, replace],
  );

  const clear = useCallback(() => replace({ assignee: null, labels: [] }), [replace]);

  const isEmpty = filters.assignee === null && filters.labels.length === 0;

  return { filters, setAssignee, setLabels, toggleLabel, clear, isEmpty };
}
