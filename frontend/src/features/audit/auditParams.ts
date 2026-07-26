import type { AuditQueryInput } from '@tasker/config';

export type AuditParams = Partial<AuditQueryInput>;

/** Parse URL searchParams into an {@link AuditParams}. */
export function fromUrl(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): AuditParams {
  const get = (key: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
    const v = sp[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const csv = (raw: string | undefined): string[] | undefined =>
    raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

  return {
    actorUserId: get('actorUserId') || undefined,
    event: csv(get('event')),
    targetType: csv(get('targetType')),
    from: get('from') || undefined,
    to: get('to') || undefined,
    limit: 50,
  };
}

export function toUrl(params: AuditParams): string {
  const search = new URLSearchParams();
  if (params.actorUserId) search.set('actorUserId', params.actorUserId);
  if (params.event && params.event.length) search.set('event', params.event.join(','));
  if (params.targetType && params.targetType.length) {
    search.set('targetType', params.targetType.join(','));
  }
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  return search.toString();
}
