'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { ProjectIcon } from './ProjectIcon';
import { cn } from '@/lib/utils';

interface ProjectSwitcherProps {
  workspaceSlug: string;
  collapsed?: boolean;
}

const MAX_VISIBLE = 6;

export function ProjectSwitcher({ workspaceSlug, collapsed = false }: ProjectSwitcherProps) {
  const t = useTranslations('projects.switcher');
  const pathname = usePathname() ?? '';
  const query = useProjects(workspaceSlug, { status: 'ACTIVE' });
  const projects = query.data?.items ?? [];
  const visible = projects.slice(0, MAX_VISIBLE);

  if (collapsed) {
    return (
      <div className="flex flex-col gap-1" aria-label={t('label')}>
        {visible.map((project) => (
          <Link
            key={project.id}
            href={`/${workspaceSlug}/projects/${project.slug}/board`}
            className="flex h-9 items-center justify-center rounded-md hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={project.name}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: project.color }}
              aria-hidden="true"
            >
              <ProjectIcon name={project.icon} className="h-3.5 w-3.5" />
            </span>
            <span className="sr-only">{project.name}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('label')}
      </p>
      {projects.length === 0 && !query.isLoading ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">{t('empty')}</p>
      ) : null}
      {visible.map((project) => {
        const href = `/${workspaceSlug}/projects/${project.slug}/board`;
        const active = pathname.startsWith(`/${workspaceSlug}/projects/${project.slug}`);
        return (
          <Link
            key={project.id}
            href={href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white"
              style={{ backgroundColor: project.color }}
              aria-hidden="true"
            >
              <ProjectIcon name={project.icon} className="h-3 w-3" />
            </span>
            <span className="truncate">{project.name}</span>
          </Link>
        );
      })}
      {projects.length > MAX_VISIBLE ? (
        <Link
          href={`/${workspaceSlug}/projects`}
          className="mt-1 px-3 py-1 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('openAll')}
        </Link>
      ) : null}
    </div>
  );
}
