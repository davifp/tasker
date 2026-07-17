'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { bff } from '@/lib/http/bff';
import { equivalentPathInWorkspace } from '@/components/shell/nav-links';

export interface WorkspaceOption {
  id: string;
  slug: string;
  name: string;
}

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceOption[];
  currentSlug: string;
}

export function WorkspaceSwitcher({ workspaces, currentSlug }: WorkspaceSwitcherProps) {
  const t = useTranslations('shell.workspaceSwitcher');
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [, startTransition] = useTransition();

  const current = workspaces.find((workspace) => workspace.slug === currentSlug);

  function selectWorkspace(target: WorkspaceOption) {
    if (target.slug === currentSlug) return;
    startTransition(async () => {
      try {
        await bff.post('/workspaces/select', { slug: target.slug });
      } catch {
        // ignore; navigation will fall back to the fresh workspace page
      }
      const nextPath = equivalentPathInWorkspace(pathname, currentSlug, target.slug);
      router.push(nextPath);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 min-w-[10rem] justify-between gap-2 truncate text-sm"
          aria-label={t('label')}
        >
          <span className="truncate">{current?.name ?? t('empty')}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.length === 0 ? (
          <DropdownMenuItem disabled>{t('empty')}</DropdownMenuItem>
        ) : (
          workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={(event) => {
                event.preventDefault();
                selectWorkspace(workspace);
              }}
            >
              <span className="flex-1 truncate">{workspace.name}</span>
              {workspace.slug === currentSlug ? (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            router.push('/workspaces/new');
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('createNew')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
