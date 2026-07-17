'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { primaryNavLinks, managementNavLinks, type NavLink } from './nav-links';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'tsk.sidebar.collapsed';

function SidebarLink({
  link,
  active,
  collapsed,
  label,
}: {
  link: NavLink;
  active: boolean;
  collapsed: boolean;
  label: string;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href('placeholder')}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground',
      )}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </Link>
  );
}

interface SidebarProps {
  workspaceSlug: string;
}

export function Sidebar({ workspaceSlug }: SidebarProps) {
  const pathname = usePathname() ?? '';
  const t = useTranslations('shell.nav');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === '1') setCollapsed(true);
    } catch {
      // no-op
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // no-op
      }
      return next;
    });
  }

  const primary = primaryNavLinks.map((link) => ({
    ...link,
    href: () => link.href(workspaceSlug),
  }));
  const management = managementNavLinks.map((link) => ({
    ...link,
    href: () => link.href(workspaceSlug),
  }));

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-background pb-4 pt-4 transition-[width] duration-200 md:flex md:flex-col',
        collapsed ? 'w-16 px-2' : 'w-56 px-4',
      )}
      aria-label={t('label')}
      data-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <Link
        href={`/${workspaceSlug}/projects`}
        className="mb-4 flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        {collapsed ? <span className="sr-only">Tasker</span> : <span>Tasker</span>}
      </Link>
      <nav className="flex flex-col gap-1">
        {primary.map((link) => (
          <SidebarLink
            key={link.key}
            link={{ ...link, href: () => link.href() }}
            active={link.match(pathname, workspaceSlug)}
            collapsed={collapsed}
            label={t(link.key)}
          />
        ))}
      </nav>
      <Separator className="my-4" />
      <nav className="flex flex-col gap-1">
        {management.map((link) => (
          <SidebarLink
            key={link.key}
            link={{ ...link, href: () => link.href() }}
            active={link.match(pathname, workspaceSlug)}
            collapsed={collapsed}
            label={t(link.key)}
          />
        ))}
      </nav>
      <div className="mt-auto pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="w-full justify-center"
          aria-label={collapsed ? t('expand') : t('collapse')}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span>{t('collapse')}</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
