'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
import { Button } from '@/components/ui/button';

export interface DeletedWorkspace {
  id: string;
  slug: string;
  name: string;
  deletedAt: string;
  restoreDeadline: string;
}

interface DeletedWorkspacesListProps {
  workspaces: DeletedWorkspace[];
}

export function DeletedWorkspacesList({ workspaces }: DeletedWorkspacesListProps) {
  const t = useTranslations('workspace.deleted');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function restore(slug: string) {
    startTransition(async () => {
      try {
        await browserHttp.post(`/workspaces/${encodeURIComponent(slug)}/restore`);
        toast.success(t('restored'));
        router.refresh();
      } catch {
        toast.error(t('restoreFailed'));
      }
    });
  }

  if (workspaces.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {workspaces.map((workspace) => (
        <li
          key={workspace.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
        >
          <div className="min-w-0">
            <p className="font-medium text-foreground">{workspace.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('deletedOn', { date: workspace.deletedAt })} ·{' '}
              {t('restoreBefore', { date: workspace.restoreDeadline })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => restore(workspace.slug)}
          >
            {t('restore')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
