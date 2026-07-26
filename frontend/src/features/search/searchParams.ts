import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@tasker/config';
import type { SearchParams } from './useSearchQuery';

/** Parse URL searchParams into a typed {@link SearchParams}. */
export function fromUrl(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchParams {
  const get = (key: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
    const v = sp[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const q = get('q') ?? '';
  const typeRaw = get('type');
  const type = typeRaw
    ? (typeRaw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is SearchEntityType =>
          (SEARCH_ENTITY_TYPES as readonly string[]).includes(s),
        ) as SearchEntityType[])
    : undefined;
  return {
    q,
    type: type && type.length ? type : undefined,
    projectId: get('projectId') || undefined,
    authorUserId: get('authorUserId') || undefined,
    from: get('from') || undefined,
    to: get('to') || undefined,
    limit: 20,
  };
}

/** Serialize typed params back to a query-string. */
export function toUrl(params: SearchParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.type && params.type.length) search.set('type', [...params.type].sort().join(','));
  if (params.projectId) search.set('projectId', params.projectId);
  if (params.authorUserId) search.set('authorUserId', params.authorUserId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  return search.toString();
}
