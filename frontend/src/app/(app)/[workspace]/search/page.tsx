import { getTranslations } from 'next-intl/server';
import { fromUrl } from '@/features/search/searchParams';
import { SearchResults } from '@/features/search/SearchResults';
import { SearchFilters } from '@/features/search/SearchFilters';

/**
 * Dedicated search page. Filters live in the URL so the state is
 * browser-back / copy-paste shareable. Rendered as a Server Component to
 * lock in a fast static shell; the interactive parts (filters, results)
 * are client-only and share a TanStack Query cache with the ⌘K palette.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspace }, sp, t] = await Promise.all([
    params,
    searchParams,
    getTranslations('search'),
  ]);
  const parsed = fromUrl(sp);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <aside>
          <SearchFilters workspaceSlug={workspace} params={parsed} />
        </aside>
        <main>
          <SearchResults workspaceSlug={workspace} params={parsed} />
        </main>
      </div>
    </section>
  );
}
