import type { SearchEntityType } from '@tasker/config';

export type { SearchEntityType };

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

export interface SearchQueryOptions {
  workspaceId: string;
  workspaceSlug: string;
  q: string;
  types?: SearchEntityType[];
  projectId?: string;
  authorUserId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

// Cursor encodes (rank, id, type) so pagination survives ties in rank.
// Kept opaque to the client — base64(JSON).
export interface SearchCursor {
  r: number;
  i: string;
  t: SearchEntityType;
}
