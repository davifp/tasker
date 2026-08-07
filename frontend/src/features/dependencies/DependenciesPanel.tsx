'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useDependencies, useAddDependency, useRemoveDependency } from './hooks/useDependencies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HttpError } from '@/lib/http/errors';
import { toastFromError } from '@/lib/errors/toastFromError';

interface DependenciesPanelProps {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

export function DependenciesPanel({
  workspaceSlug,
  projectSlug,
  taskNumber,
}: DependenciesPanelProps) {
  const t = useTranslations('board.dependencies');
  const coords = { workspaceSlug, projectSlug, taskNumber };
  const { data, isLoading } = useDependencies(coords);
  const add = useAddDependency(coords);
  const remove = useRemoveDependency(coords);
  const [candidate, setCandidate] = useState('');

  async function commit() {
    const value = candidate.trim();
    if (!value) return;
    try {
      await add.mutateAsync({ blockedByTaskId: value });
      setCandidate('');
    } catch (err) {
      if (err instanceof HttpError && err.type.endsWith('/dependency-cycle')) {
        toast.error(t('errors.cycle'));
        return;
      }
      toastFromError(err, t('errors.addFailed'));
    }
  }

  const items = data ?? [];

  return (
    <section className="flex flex-col gap-2" aria-label={t('label')}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')} <span className="ml-1 text-muted-foreground">({items.length})</span>
      </h4>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((dep) => (
            <li
              key={dep.blockedByTaskId}
              className="group flex items-center justify-between rounded-md border border-border px-2 py-1.5"
            >
              <span className="font-mono text-xs text-foreground">{dep.blockedByTaskId}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove.mutate({ blockerId: dep.blockedByTaskId })}
                aria-label={t('removeAria')}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={candidate}
          onChange={(event) => setCandidate(event.target.value)}
          placeholder={t('addPlaceholder')}
          aria-label={t('addLabel')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
        />
        <Button type="button" size="sm" onClick={() => void commit()} disabled={add.isPending}>
          {t('add')}
        </Button>
      </div>
    </section>
  );
}
