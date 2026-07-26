'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteSearchQuery, type SearchParams } from './useSearchQuery';
import { SearchSnippet } from './SearchSnippet';

interface SearchResultsProps {
  workspaceSlug: string;
  params: SearchParams;
}

export function SearchResults({ workspaceSlug, params }: SearchResultsProps) {
  const t = useTranslations('search.results');
  const query = useInfiniteSearchQuery({
    workspaceSlug,
    params: { ...params, limit: 20 },
    enabled: params.q.trim().length > 0,
  });

  if (params.q.trim().length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t('typeToStart')}</p>;
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-muted-foreground">{t('error')}</p>
        <Button onClick={() => query.refetch()} variant="outline" size="sm">
          {t('retry')}
        </Button>
      </div>
    );
  }

  const allHits = query.data?.pages.flatMap((p) => p.hits) ?? [];
  if (allHits.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <p>{t('empty', { q: params.q })}</p>
        <p className="mt-2">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {allHits.map((hit) => (
        <Link
          key={`${hit.type}-${hit.id}`}
          href={hit.url}
          className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{t(`type.${hit.type}`)}</Badge>
                <span className="truncate font-medium">{hit.label}</span>
              </div>
              {hit.snippet ? (
                <SearchSnippet
                  html={hit.snippet}
                  className="mt-1 line-clamp-2 text-sm text-muted-foreground"
                />
              ) : null}
            </div>
            {hit.projectName ? (
              <span className="shrink-0 text-xs text-muted-foreground">{hit.projectName}</span>
            ) : null}
          </div>
        </Link>
      ))}

      {query.hasNextPage ? (
        <div className="flex justify-center py-4">
          <Button
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            variant="outline"
          >
            {query.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
