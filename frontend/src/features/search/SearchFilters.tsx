'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@tasker/config';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SearchParams } from './useSearchQuery';
import { toUrl } from './searchParams';

interface SearchFiltersProps {
  workspaceSlug: string;
  params: SearchParams;
}

export function SearchFilters({ workspaceSlug: _workspaceSlug, params }: SearchFiltersProps) {
  const t = useTranslations('search.filters');
  const router = useRouter();
  const pathname = usePathname();

  function updateUrl(next: SearchParams): void {
    const qs = toUrl(next);
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  function setQ(value: string): void {
    updateUrl({ ...params, q: value });
  }

  function toggleType(type: SearchEntityType): void {
    const current = new Set(params.type ?? []);
    if (current.has(type)) current.delete(type);
    else current.add(type);
    updateUrl({ ...params, type: current.size ? [...current] : undefined });
  }

  function clear(): void {
    updateUrl({ q: params.q, limit: params.limit });
  }

  const hasFilters = Boolean(
    params.type?.length || params.projectId || params.authorUserId || params.from || params.to,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium">{t('query')}</label>
        <Input
          value={params.q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('query')}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">{t('type')}</label>
        <div className="flex flex-wrap gap-2">
          {SEARCH_ENTITY_TYPES.map((type) => {
            const selected = params.type?.includes(type) ?? false;
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={selected}
                className="focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
              >
                <Badge variant={selected ? 'default' : 'outline'} className="cursor-pointer">
                  {t(`entity.${type}`)}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clear} className="self-start">
          {t('clear')}
        </Button>
      ) : null}
    </div>
  );
}
