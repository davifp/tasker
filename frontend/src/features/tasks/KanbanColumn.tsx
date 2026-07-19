'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import type { Task, TaskStatus } from '@/lib/http/types';
import { cn } from '@/lib/utils';
import { TaskCard } from './TaskCard';
import { TaskQuickAdd } from './TaskQuickAdd';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  quickAddDisabled?: boolean;
  onOpenTask: (taskNumber: number) => void;
  onQuickAdd: (title: string, status: TaskStatus) => Promise<void> | void;
}

export function KanbanColumn({
  status,
  tasks,
  quickAddDisabled,
  onOpenTask,
  onQuickAdd,
}: KanbanColumnProps) {
  const t = useTranslations('board');
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: 'column', status },
  });
  const columnLabel = t(`columns.${status}`);
  return (
    <section
      className="flex h-full min-w-[280px] flex-1 flex-col rounded-lg border border-border bg-muted/40"
      aria-label={t('columnLabel', { column: columnLabel })}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {columnLabel}
          </h3>
          <span
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-medium text-muted-foreground"
            aria-label={t('columnCount', { count: tasks.length })}
          >
            {tasks.length}
          </span>
        </div>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2 p-2 transition-colors',
          isOver && 'bg-primary/5 ring-2 ring-primary/40',
        )}
      >
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </ul>
        </SortableContext>
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            {t('emptyColumn')}
          </p>
        ) : null}
        <TaskQuickAdd status={status} disabled={quickAddDisabled} onSubmit={onQuickAdd} />
      </div>
    </section>
  );
}
