'use client';

import { useEffect, useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { searchHttp, type SearchResult } from '@/lib/http/search';
import type { SearchQueryInput } from '@tasker/config';

const DEBOUNCE_MS = 150;

export type SearchParams = Partial<SearchQueryInput> & { q: string };

/**
 * Shared cache key so ⌘K palette and /search page share results within
 * `staleTime`. Kept sorted so semantically-identical queries produce the
 * same key regardless of argument order.
 */
export function searchQueryKey(workspaceSlug: string, params: SearchParams): unknown[] {
  const normalized: Record<string, unknown> = { q: params.q };
  if (params.type && params.type.length > 0) normalized.type = [...params.type].sort().join(',');
  if (params.projectId) normalized.projectId = params.projectId;
  if (params.authorUserId) normalized.authorUserId = params.authorUserId;
  if (params.from) normalized.from = params.from;
  if (params.to) normalized.to = params.to;
  if (params.limit) normalized.limit = params.limit;
  return ['search', workspaceSlug, normalized];
}

/** Debounces `value` so a burst of keystrokes fires a single query. */
export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface UseSearchQueryOptions {
  workspaceSlug: string;
  params: SearchParams;
  enabled?: boolean;
}

export function useSearchQuery({ workspaceSlug, params, enabled = true }: UseSearchQueryOptions) {
  const debouncedQ = useDebounced(params.q);
  const effective = { ...params, q: debouncedQ };
  return useQuery<SearchResult>({
    queryKey: searchQueryKey(workspaceSlug, effective),
    queryFn: ({ signal }) => searchHttp.query(workspaceSlug, effective, signal),
    enabled: enabled && debouncedQ.trim().length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useInfiniteSearchQuery({
  workspaceSlug,
  params,
  enabled = true,
}: UseSearchQueryOptions) {
  return useInfiniteQuery<SearchResult, Error>({
    queryKey: searchQueryKey(workspaceSlug, params),
    queryFn: ({ signal, pageParam }) =>
      searchHttp.query(
        workspaceSlug,
        { ...params, cursor: pageParam as string | undefined },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && params.q.trim().length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
