import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mentionsHttp } from '@/lib/http/mentions';
import type { MentionSuggestion } from '@/lib/http/types';

const DEBOUNCE_MS = 120;

/**
 * Debounced mention autocomplete against the workspace member index. Returns
 * an empty list when disabled so the popover renders no options rather than
 * blinking previous results while the user keeps typing.
 *
 * The debounce is local to the hook (setState + effect) so multiple call
 * sites do not need to share a store — each MentionPopover gets its own
 * debounced query.
 */
export function useMentionSearch(input: {
  workspaceSlug: string;
  query: string;
  enabled: boolean;
  limit?: number;
}): { data: MentionSuggestion[]; isLoading: boolean } {
  const [debounced, setDebounced] = useState(input.query);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(input.query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input.query]);

  const result = useQuery({
    queryKey: ['mentions', input.workspaceSlug, 'search', debounced, input.limit ?? 10],
    queryFn: () => mentionsHttp.search(input.workspaceSlug, debounced, input.limit ?? 10),
    enabled: input.enabled && Boolean(input.workspaceSlug),
    staleTime: 30_000,
  });

  return { data: result.data ?? [], isLoading: result.isLoading };
}
