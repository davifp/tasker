'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AuditParams } from './auditParams';
import { toUrl } from './auditParams';

interface AuditFiltersProps {
  workspaceSlug: string;
  params: AuditParams;
  csvHref: string;
}

export function AuditFilters({ workspaceSlug: _slug, params, csvHref }: AuditFiltersProps) {
  const t = useTranslations('audit.filters');
  const router = useRouter();
  const pathname = usePathname();

  function updateUrl(next: AuditParams): void {
    const qs = toUrl(next);
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  function setField<K extends keyof AuditParams>(key: K, value: AuditParams[K]): void {
    updateUrl({ ...params, [key]: value });
  }

  function setCsv(key: 'event' | 'targetType', raw: string): void {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    updateUrl({ ...params, [key]: list.length ? list : undefined });
  }

  function clear(): void {
    updateUrl({ limit: params.limit });
  }

  const hasFilters = Boolean(
    params.actorUserId ||
    params.event?.length ||
    params.targetType?.length ||
    params.from ||
    params.to,
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 md:flex-row md:flex-wrap md:items-end">
      <div className="flex-1 min-w-[160px]">
        <label
          htmlFor="audit-actor"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t('actor')}
        </label>
        <Input
          id="audit-actor"
          value={params.actorUserId ?? ''}
          onChange={(e) => setField('actorUserId', e.target.value || undefined)}
          placeholder={t('actorPlaceholder')}
        />
      </div>
      <div className="flex-1 min-w-[200px]">
        <label
          htmlFor="audit-event"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t('event')}
        </label>
        <Input
          id="audit-event"
          value={(params.event ?? []).join(',')}
          onChange={(e) => setCsv('event', e.target.value)}
          placeholder={t('eventPlaceholder')}
        />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label
          htmlFor="audit-target"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t('targetType')}
        </label>
        <Input
          id="audit-target"
          value={(params.targetType ?? []).join(',')}
          onChange={(e) => setCsv('targetType', e.target.value)}
          placeholder={t('targetTypePlaceholder')}
        />
      </div>
      <div className="w-[160px]">
        <label
          htmlFor="audit-from"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t('from')}
        </label>
        <Input
          id="audit-from"
          type="date"
          value={params.from ?? ''}
          onChange={(e) => setField('from', e.target.value || undefined)}
        />
      </div>
      <div className="w-[160px]">
        <label htmlFor="audit-to" className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('to')}
        </label>
        <Input
          id="audit-to"
          type="date"
          value={params.to ?? ''}
          onChange={(e) => setField('to', e.target.value || undefined)}
        />
      </div>
      <div className="flex items-end gap-2">
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t('clear')}
          </Button>
        ) : null}
        <a href={csvHref} download>
          <Button variant="outline" size="sm">
            {t('exportCsv')}
          </Button>
        </a>
      </div>
    </div>
  );
}
