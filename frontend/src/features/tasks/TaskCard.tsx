'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import type { Task, TaskLabel } from '@/lib/http/types';
import { cn } from '@/lib/utils';
import { PriorityChip } from './PriorityChip';
import { DueDatePill } from './DueDatePill';
import { AssigneeBubble } from './AssigneeBubble';

interface TaskCardProps {
  task: Task;
  onOpen: (taskNumber: number) => void;
}

const LABEL_LIMIT = 2;

function labelChipStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}22`, color };
}

function LabelChip({ label }: { label: TaskLabel }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={labelChipStyle(label.color)}
      title={label.name}
    >
      {label.name}
    </span>
  );
}

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const t = useTranslations('board.card');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'group list-none rounded-md border border-border bg-background p-3 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring',
        isDragging && 'ring-2 ring-ring',
      )}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-2 text-left focus:outline-none"
        onClick={() => onOpen(task.number)}
        aria-label={t('open', { number: task.number, title: task.title })}
        {...attributes}
        {...listeners}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 flex-1 text-sm font-medium text-foreground">{task.title}</p>
          <AssigneeBubble userId={task.assigneeUserId} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityChip priority={task.priority} />
          {(task.labels ?? []).slice(0, LABEL_LIMIT).map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {(task.labels ?? []).length > LABEL_LIMIT ? (
            <span
              className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              aria-label={t('labelOverflow', {
                count: (task.labels ?? []).length - LABEL_LIMIT,
              })}
            >
              +{(task.labels ?? []).length - LABEL_LIMIT}
            </span>
          ) : null}
          {task.dueDate ? <DueDatePill dueDate={task.dueDate} /> : null}
          <span className="ml-auto text-[10px] font-medium text-muted-foreground">
            #{task.number}
          </span>
        </div>
      </button>
    </li>
  );
}
