'use client';

import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileNav } from './MobileNav';
import { UserMenu } from './UserMenu';
import { WorkspaceSwitcher, type WorkspaceOption } from '@/features/workspace/WorkspaceSwitcher';
import { ThemeMenu } from '@/features/theme/ThemeMenu';
import { LocaleSwitcher } from '@/features/i18n/LocaleSwitcher';

interface TopbarProps {
  workspaceSlug: string;
  workspaces: WorkspaceOption[];
  user: { name: string; email: string };
  onOpenPalette: () => void;
}

export function Topbar({ workspaceSlug, workspaces, user, onOpenPalette }: TopbarProps) {
  const t = useTranslations('shell.topbar');
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      <MobileNav workspaceSlug={workspaceSlug} />
      <WorkspaceSwitcher workspaces={workspaces} currentSlug={workspaceSlug} />
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 sm:inline-flex"
        onClick={onOpenPalette}
        aria-label={t('openPalette')}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>{t('search')}</span>
        <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        onClick={onOpenPalette}
        aria-label={t('openPalette')}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
      <ThemeMenu />
      <LocaleSwitcher />
      <UserMenu name={user.name} email={user.email} />
    </header>
  );
}
