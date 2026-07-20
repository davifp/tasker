'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Priority, Task } from '@/lib/http/types';
import type { BarGeometry } from './timeline-geometry';

interface TimelineBarProps {
  task: Task;
  geometry: BarGeometry;
  onOpen(taskNumber: number): void;
}

const PRIORITY_BAR_CLASS: Record<Priority, string> = {
  LOW: 'bg-emerald-500/70 hover:bg-emerald-500 border-emerald-600/60',
  MEDIUM: 'bg-sky-500/70 hover:bg-sky-500 border-sky-600/60',
  HIGH: 'bg-rose-500/80 hover:bg-rose-500 border-rose-600/60',
};

// Absolute-positioned bar inside a swimlane row. Geometry is computed
// upstream by `computeBarGeometry` so this component stays a pure
// presentational leaf — no date math, no clock reads.
export function TimelineBar({ task, geometry, onOpen }: TimelineBarProps) {
  const t = useTranslations('timeline');
  const priorityClass = PRIORITY_BAR_CLASS[task.priority];
  const label = t('bar.label', {
    number: task.number,
    title: task.title,
  });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onOpen(task.number)}
      className={cn(
        'absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md border px-2 text-left text-[11px] font-medium text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        priorityClass,
        geometry.clippedLeft && 'rounded-l-none border-l-0',
        geometry.clippedRight && 'rounded-r-none border-r-0',
      )}
      style={{
        left: `${geometry.leftPct}%`,
        width: `${geometry.widthPct}%`,
      }}
      data-testid={`timeline-bar-${task.number}`}
      data-task-number={task.number}
      data-left-pct={geometry.leftPct.toFixed(4)}
      data-width-pct={geometry.widthPct.toFixed(4)}
      data-clipped-left={geometry.clippedLeft || undefined}
      data-clipped-right={geometry.clippedRight || undefined}
    >
      <span className="truncate">{task.title}</span>
    </button>
  );
}
