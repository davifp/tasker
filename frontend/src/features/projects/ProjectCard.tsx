'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Project } from '@/lib/http/types';
import { ProjectIcon } from './ProjectIcon';

interface ProjectCardProps {
  workspaceSlug: string;
  project: Project;
}

export function ProjectCard({ workspaceSlug, project }: ProjectCardProps) {
  const t = useTranslations('projects');
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <Link
      href={`/${workspaceSlug}/projects/${project.slug}/board`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('list.cardOpen', { name: project.name })}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: project.color }}
          aria-hidden="true"
        >
          <ProjectIcon name={project.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
            {project.name}
          </h3>
          {project.description ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('card.updated', { date: formatter.format(new Date(project.updatedAt)) })}
      </p>
    </Link>
  );
}
