'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/http/types';
import { ProjectIcon } from './ProjectIcon';
import { cn } from '@/lib/utils';

interface ProjectHeaderProps {
  workspaceSlug: string;
  project: Project;
}

const TABS = ['board', 'list', 'backlog', 'timeline'] as const;

// Matched by the `id` on the tabpanel wrapper in [project]/layout.tsx.
// Kept here so any structural rename fans out from a single constant.
export const PROJECT_TABPANEL_ID = 'project-tabpanel';

// Route-driven tabs. Each tab is a Link that changes segment, so
// pathname is the source of truth for the active state. Uses the
// WAI-ARIA `tablist` pattern with `role="tab"` on the link + roving
// tabindex-style handling delegated to native focus flow (arrow keys
// operate on the tablist).
export function ProjectHeader({ workspaceSlug, project }: ProjectHeaderProps) {
  const t = useTranslations('projects.header');
  const pathname = usePathname() ?? '';
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: project.color }}
          aria-hidden="true"
        >
          <ProjectIcon name={project.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-foreground">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{project.description}</p>
          ) : null}
        </div>
      </div>
      <nav
        role="tablist"
        aria-label={t('openProjectMenu')}
        className="flex flex-wrap gap-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const links = event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]');
          const current = document.activeElement as HTMLAnchorElement | null;
          const currentIndex = Array.from(links).findIndex((el) => el === current);
          if (currentIndex === -1) return;
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          const nextIndex = (currentIndex + direction + links.length) % links.length;
          links[nextIndex]?.focus();
          event.preventDefault();
        }}
      >
        {TABS.map((tab) => {
          const href = `/${workspaceSlug}/projects/${project.slug}/${tab}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab}
              role="tab"
              aria-selected={active}
              aria-controls={PROJECT_TABPANEL_ID}
              href={href}
              className={cn(
                'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t(`tabs.${tab}`)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
