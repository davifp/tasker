'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { useChecklist } from './hooks/useChecklist';
import {
  useAddChecklistItem,
  useDeleteChecklistItem,
  useRenameChecklistItem,
  useToggleChecklistItem,
} from './hooks/useChecklistMutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HttpError } from '@/lib/http/errors';

interface ChecklistPanelProps {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

const MAX_ITEM_LEN = 200;

export function ChecklistPanel({ workspaceSlug, projectSlug, taskNumber }: ChecklistPanelProps) {
  const t = useTranslations('board.checklist');
  const coords = { workspaceSlug, projectSlug, taskNumber };
  const { data, isLoading } = useChecklist(workspaceSlug, projectSlug, taskNumber);
  const add = useAddChecklistItem(coords);
  const toggle = useToggleChecklistItem(coords);
  const remove = useDeleteChecklistItem(coords);
  const rename = useRenameChecklistItem(coords);
  const [pending, setPending] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);

  async function commitRename() {
    if (!editing) return;
    const next = editing.title.trim();
    if (!next) return;
    try {
      await rename.mutateAsync({ itemId: editing.id, title: next });
      setEditing(null);
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.renameFailed'));
    }
  }

  const items = data ?? [];
  const total = items.length;
  const done = items.filter((i) => i.checked).length;

  async function commit() {
    const title = pending.trim();
    if (!title) return;
    try {
      await add.mutateAsync({ title });
      setPending('');
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.addFailed'));
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('label')}>
      <header className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('heading')}
        </h4>
        {total > 0 ? (
          <span className="text-xs text-muted-foreground">{t('progress', { done, total })}</span>
        ) : null}
      </header>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const inEdit = editing?.id === item.id;
            return (
              <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1">
                <input
                  id={`checklist-item-${item.id}`}
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) =>
                    toggle.mutate({ itemId: item.id, checked: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                {inEdit ? (
                  <Input
                    value={editing.title}
                    onChange={(event) =>
                      setEditing({ id: item.id, title: event.target.value.slice(0, MAX_ITEM_LEN) })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitRename();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditing(null);
                      }
                    }}
                    className="h-7 flex-1 text-sm"
                    aria-label={t('renameLabel')}
                  />
                ) : (
                  <label
                    htmlFor={`checklist-item-${item.id}`}
                    className={
                      item.checked
                        ? 'flex-1 text-sm text-muted-foreground line-through'
                        : 'flex-1 text-sm text-foreground'
                    }
                  >
                    {item.title}
                  </label>
                )}
                {inEdit ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => void commitRename()}
                      aria-label={t('saveAria')}
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setEditing(null)}
                      aria-label={t('cancelAria')}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setEditing({ id: item.id, title: item.title })}
                      aria-label={t('renameAria', { title: item.title })}
                    >
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        remove.mutate({ itemId: item.id });
                      }}
                      aria-label={t('deleteAria', { title: item.title })}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={pending}
          onChange={(event) => setPending(event.target.value.slice(0, MAX_ITEM_LEN))}
          placeholder={t('addPlaceholder')}
          aria-label={t('addLabel')}
          maxLength={MAX_ITEM_LEN}
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
