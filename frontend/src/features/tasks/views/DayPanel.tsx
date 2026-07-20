'use client';

import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { Task } from '@/lib/http/types';
import { PriorityChip } from '../PriorityChip';
import { AssigneeBubble } from '../AssigneeBubble';

interface DayPanelProps {
  // The workspace-tz calendar day the panel is displaying, formatted for the header.
  displayDate: string | null;
  tasks: readonly Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (taskNumber: number) => void;
}

// Lightweight sheet listing every task whose workspace-tz `dueDate`
// falls on the selected day. Selecting a task fires the shared
// `TaskDrawer` (owned by the parent CalendarView) — this panel is
// intentionally minimal so both panels can coexist on screen without
// stacking Radix focus scopes.
export function DayPanel({
  displayDate,
  tasks,
  open,
  onOpenChange,
  onOpenTask,
}: DayPanelProps) {
  const t = useTranslations('calendar.dayPanel');
  const title = displayDate ? t('title', { date: displayDate }) : t('titleEmpty');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-sm overflow-y-auto sm:max-w-sm"
        data-testid="calendar-day-panel"
      >
        <SheetHeader className="gap-1">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {t('count', { count: tasks.length })}
          </SheetDescription>
        </SheetHeader>
        {tasks.length === 0 ? (
          <div
            className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground"
            role="status"
          >
            {t('empty')}
          </div>
        ) : (
          <ul
            className="mt-4 flex flex-col gap-2"
            aria-label={t('listLabel')}
            data-testid="calendar-day-panel-list"
          >
            {tasks.map((task) => (
              <li key={task.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-md border border-border p-3 text-left"
                  onClick={() => onOpenTask(task.number)}
                  data-testid={`calendar-day-panel-task-${task.number}`}
                >
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">
                      {task.title}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-muted-foreground">
                      #{task.number}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <PriorityChip priority={task.priority} />
                    <AssigneeBubble userId={task.assigneeUserId} />
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
