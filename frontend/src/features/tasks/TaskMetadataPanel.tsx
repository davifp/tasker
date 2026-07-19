'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpdateTask } from './hooks/useUpdateTask';
import { HttpError } from '@/lib/http/errors';
import type { Priority, Task } from '@/lib/http/types';
import { PriorityChip } from './PriorityChip';
import { AssigneeBubble } from './AssigneeBubble';
import { LabelMultiSelect } from './LabelMultiSelect';
import { cn } from '@/lib/utils';

interface TaskMetadataPanelProps {
  workspaceSlug: string;
  projectSlug: string;
  task: Task;
}

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH'];

// Native `<input type="date">` expects `YYYY-MM-DD`. To avoid the UTC
// midnight → previous-day-in-local-tz gotcha, we round-trip the raw date
// string with a local-midnight ISO expansion rather than
// `new Date(value).toISOString()`.
function toLocalMidnightIso(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toISOString();
}

function isoToDateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function TaskMetadataPanel({ workspaceSlug, projectSlug, task }: TaskMetadataPanelProps) {
  const t = useTranslations('board.metadata');
  const update = useUpdateTask(workspaceSlug, projectSlug);
  const [assigneeDraft, setAssigneeDraft] = useState(task.assigneeUserId ?? '');
  const [dueDateDraft, setDueDateDraft] = useState(isoToDateOnly(task.dueDate));

  useEffect(() => {
    setAssigneeDraft(task.assigneeUserId ?? '');
  }, [task.assigneeUserId]);

  useEffect(() => {
    setDueDateDraft(isoToDateOnly(task.dueDate));
  }, [task.dueDate]);

  async function commit(patch: Parameters<typeof update.mutateAsync>[0]['patch']) {
    try {
      await update.mutateAsync({ number: task.number, patch });
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.updateFailed'));
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t('label')}>
      <div className="grid gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('priority')}
        </span>
        <div className="flex gap-1" role="radiogroup" aria-label={t('priority')}>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={task.priority === p}
              tabIndex={task.priority === p ? 0 : -1}
              onClick={() => void commit({ priority: p })}
              className={cn(
                'rounded-md p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                task.priority === p && 'ring-2 ring-primary',
              )}
            >
              <PriorityChip priority={p} />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1">
        <label
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          htmlFor={`task-${task.number}-assignee`}
        >
          {t('assignee')}
        </label>
        <div className="flex items-center gap-2">
          <AssigneeBubble userId={task.assigneeUserId} />
          <input
            id={`task-${task.number}-assignee`}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={assigneeDraft}
            onChange={(event) => setAssigneeDraft(event.target.value)}
            placeholder={t('assigneePlaceholder')}
            onBlur={() => {
              const next = assigneeDraft.trim();
              const value = next.length === 0 ? null : next;
              if (value === task.assigneeUserId) return;
              void commit({ assigneeUserId: value });
            }}
          />
        </div>
      </div>

      <div className="grid gap-1">
        <label
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          htmlFor={`task-${task.number}-duedate`}
        >
          {t('dueDate')}
        </label>
        <input
          id={`task-${task.number}-duedate`}
          type="date"
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          value={dueDateDraft}
          onChange={(event) => {
            const next = event.target.value;
            setDueDateDraft(next);
            const value = next ? toLocalMidnightIso(next) : null;
            const currentDateOnly = isoToDateOnly(task.dueDate);
            if (next === currentDateOnly) return;
            void commit({ dueDate: value });
          }}
        />
      </div>

      <LabelMultiSelect
        workspaceSlug={workspaceSlug}
        selectedIds={(task.labels ?? []).map((label) => label.id)}
        onChange={(labelIds) => void commit({ labelIds })}
      />
    </section>
  );
}
