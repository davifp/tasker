import type { SearchEntityType, SearchQueryInput } from '@tasker/config';
import { browserHttp } from './browser';

export interface SearchHit {
  type: SearchEntityType;
  id: string;
  label: string;
  snippet: string;
  url: string;
  rank: number;
  projectSlug?: string;
  projectName?: string;
  workspaceSlug: string;
}

export interface SearchResult {
  hits: SearchHit[];
  nextCursor: string | null;
}

function buildQuery(params: Partial<SearchQueryInput> & { q: string }): string {
  const search = new URLSearchParams();
  search.set('q', params.q);
  if (params.type && params.type.length > 0) search.set('type', params.type.join(','));
  if (params.projectId) search.set('projectId', params.projectId);
  if (params.authorUserId) search.set('authorUserId', params.authorUserId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  return search.toString();
}

export const searchHttp = {
  query(
    workspaceSlug: string,
    params: Partial<SearchQueryInput> & { q: string },
    signal?: AbortSignal,
  ) {
    return browserHttp.get<SearchResult>(
      `/workspaces/${workspaceSlug}/search?${buildQuery(params)}`,
      { signal },
    );
  },
};
