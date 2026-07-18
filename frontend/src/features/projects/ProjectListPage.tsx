'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog } from './CreateProjectDialog';

interface ProjectListPageProps {
  workspaceSlug: string;
}

// Client component so the list can respond to cache invalidations when
// the create dialog succeeds without a full route refresh. The parent
// layout stays RSC.
export function ProjectListPage({ workspaceSlug }: ProjectListPageProps) {
  const t = useTranslations('projects.list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const query = useProjects(workspaceSlug);

  const projects = query.data?.items ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('newProject')}
        </Button>
      </header>

      {query.isLoading ? <ProjectGridSkeleton /> : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : null}
      {!query.isLoading && !query.isError && projects.length === 0 ? (
        <EmptyState onCreate={() => setDialogOpen(true)} />
      ) : null}
      {projects.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-grid">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard workspaceSlug={workspaceSlug} project={project} />
            </li>
          ))}
        </ul>
      ) : null}

      <CreateProjectDialog
        workspaceSlug={workspaceSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </section>
  );
}

function ProjectGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-32 rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('projects.list.empty');
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center"
      data-testid="project-empty-state"
    >
      <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <Button onClick={onCreate}>{t('cta')}</Button>
    </div>
  );
}
