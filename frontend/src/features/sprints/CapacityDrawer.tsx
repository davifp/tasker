'use client';

import { AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface CapacityRow {
  memberUserId: string;
  displayName: string;
  capacityPoints: number;
  assignedPoints: number;
}

export interface CapacityDrawerProps {
  rows: CapacityRow[];
}

/**
 * Renders the per-member capacity vs. estimated load. Over-allocation is
 * signalled by icon + text + color (PRD accessibility requirement — color
 * must never be the sole signal).
 */
export function CapacityDrawer({ rows }: CapacityDrawerProps): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-member capacity set. Sprints without capacity accept any load.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" role="list">
      {rows.map((row) => (
        <CapacityRowView key={row.memberUserId} row={row} />
      ))}
    </ul>
  );
}

function CapacityRowView({ row }: { row: CapacityRow }): React.JSX.Element {
  const overallocated = row.capacityPoints > 0 && row.assignedPoints > row.capacityPoints;
  const percent = row.capacityPoints > 0 ? (row.assignedPoints / row.capacityPoints) * 100 : 0;
  return (
    <li className="flex flex-col gap-1" data-testid={`capacity-${row.memberUserId}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{row.displayName}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1',
            overallocated ? 'font-semibold text-destructive' : 'text-muted-foreground',
          )}
        >
          {overallocated ? <AlertCircle className="h-3 w-3" aria-hidden /> : null}
          {row.assignedPoints} / {row.capacityPoints} pts
          {overallocated ? <span className="sr-only">Over-allocated</span> : null}
        </span>
      </div>
      <Progress value={Math.min(percent, 100)} aria-label={`${row.displayName} capacity`} />
      {overallocated ? (
        <p className="text-[11px] text-destructive" role="alert">
          Over-allocated by {row.assignedPoints - row.capacityPoints} pts. This warning is
          informational — you can still start the sprint.
        </p>
      ) : null}
    </li>
  );
}
