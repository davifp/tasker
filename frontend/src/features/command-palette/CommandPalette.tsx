'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useSearchQuery } from '@/features/search/useSearchQuery';
import { SearchSnippet } from '@/features/search/SearchSnippet';
import { useRecentItems } from '@/features/search/recentItems';
import type { SearchEntityType } from '@tasker/config';
import type { SearchHit } from '@/lib/http/search';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug?: string;
}

const GROUP_ORDER: SearchEntityType[] = ['task', 'project', 'sprint', 'member'];
const GROUP_LABEL_KEY: Record<SearchEntityType, 'tasks' | 'projects' | 'sprints' | 'members'> = {
  task: 'tasks',
  project: 'projects',
  sprint: 'sprints',
  member: 'members',
};

export function CommandPalette({ open, onOpenChange, workspaceSlug }: CommandPaletteProps) {
  const t = useTranslations('shell.commandPalette');
  const router = useRouter();
  const [q, setQ] = useState('');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  // Reset the query when the dialog closes so re-opening starts fresh.
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const { items: recentItems, push: pushRecent } = useRecentItems(workspaceSlug ?? '');
  const searchQuery = useSearchQuery({
    workspaceSlug: workspaceSlug ?? '',
    params: { q, limit: 8 },
    enabled: Boolean(workspaceSlug) && open,
  });

  const grouped = useMemo(() => {
    const map = new Map<SearchEntityType, SearchHit[]>();
    for (const hit of searchQuery.data?.hits ?? []) {
      const list = map.get(hit.type) ?? [];
      list.push(hit);
      map.set(hit.type, list);
    }
    return map;
  }, [searchQuery.data]);

  const showRecents = q.trim().length === 0 && recentItems.length > 0;
  const showEmpty =
    q.trim().length > 0 && !searchQuery.isLoading && (searchQuery.data?.hits.length ?? 0) === 0;

  function navigate(hit: SearchHit) {
    pushRecent({ type: hit.type, id: hit.id, label: hit.label, url: hit.url });
    onOpenChange(false);
    router.push(hit.url);
  }

  function navigateRecent(item: (typeof recentItems)[number]) {
    onOpenChange(false);
    router.push(item.url);
  }

  function seeAllResults() {
    if (!workspaceSlug || !q.trim()) return;
    onOpenChange(false);
    const params = new URLSearchParams({ q });
    router.push(`/${workspaceSlug}/search?${params.toString()}`);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        {searchQuery.isLoading && q.trim().length > 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : null}

        {showEmpty ? <CommandEmpty>{t('noResults')}</CommandEmpty> : null}

        {showRecents ? (
          <CommandGroup heading={t('recent')}>
            {recentItems.map((item) => (
              <CommandItem
                key={`recent-${item.id}`}
                value={`recent-${item.id}-${item.label}`}
                onSelect={() => navigateRecent(item)}
              >
                <span className="truncate">{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {GROUP_ORDER.filter((type) => (grouped.get(type)?.length ?? 0) > 0).map((type, i, arr) => {
          const hits = grouped.get(type)!;
          return (
            <div key={type}>
              {i > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={t(`groups.${GROUP_LABEL_KEY[type]}`)}>
                {hits.map((hit) => (
                  <CommandItem
                    key={`${hit.type}-${hit.id}`}
                    value={`${hit.type}-${hit.id}-${hit.label}`}
                    onSelect={() => navigate(hit)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{hit.label}</span>
                      {hit.snippet ? (
                        <SearchSnippet
                          html={hit.snippet}
                          className="truncate text-xs text-muted-foreground"
                        />
                      ) : null}
                    </div>
                    {hit.projectName ? <CommandShortcut>{hit.projectName}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
              {i === arr.length - 1 && q.trim().length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem value="__see_all__" onSelect={seeAllResults}>
                      <span className="text-sm">{t('seeAll', { q })}</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
