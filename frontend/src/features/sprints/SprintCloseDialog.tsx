'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HttpError } from '@/lib/http/errors';
import { sprintsHttp, type SprintCloseSummary } from '@/lib/http/sprints';
import { sprintKeys } from '@/features/queryKeys';

export interface SprintCloseDialogProps {
  workspaceSlug: string;
  projectSlug: string;
  sprintNumber: number;
  summary: SprintCloseSummary;
  nextSprintNumber: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Renders the closure summary (planned/delivered/slipped counts + velocity)
 * and offers a one-click rollover of slipped tasks into the caller-supplied
 * next sprint.
 */
export function SprintCloseDialog({
  workspaceSlug,
  projectSlug,
  sprintNumber,
  summary,
  nextSprintNumber,
  open,
  onOpenChange,
}: SprintCloseDialogProps): React.JSX.Element {
  const [rolledOver, setRolledOver] = useState(false);
  const queryClient = useQueryClient();

  const rollover = useMutation({
    mutationFn: async () => {
      if (!nextSprintNumber || summary.slippedTaskIds.length === 0) return;
      const idempotencyKey = crypto.randomUUID();
      await sprintsHttp.mutateTasks(
        workspaceSlug,
        projectSlug,
        nextSprintNumber,
        { add: summary.slippedTaskIds, remove: [] },
        idempotencyKey,
      );
    },
    onSuccess: async () => {
      setRolledOver(true);
      toast.success('Slipped tasks moved to the next sprint');
      await queryClient.invalidateQueries({
        queryKey: sprintKeys.all(workspaceSlug, projectSlug),
      });
    },
    onError: (err) => {
      const message =
        err instanceof HttpError ? (err.detail ?? err.title ?? err.message) : 'Rollover failed';
      toast.error(message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sprint {sprintNumber} complete</DialogTitle>
          <DialogDescription>
            All numbers below are derived from the closing snapshot and do not change on later task
            edits.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <SummaryStat
            label="Planned"
            value={`${summary.plannedCount} · ${summary.plannedEstimate} pts`}
          />
          <SummaryStat
            label="Delivered"
            value={`${summary.deliveredCount} · ${summary.deliveredEstimate} pts`}
          />
          <SummaryStat
            label="Slipped"
            value={`${summary.slippedCount} · ${summary.slippedEstimate} pts`}
          />
          <SummaryStat label="Velocity" value={`${summary.velocity} pts`} />
        </dl>
        <DialogFooter>
          {nextSprintNumber && summary.slippedTaskIds.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={rollover.isPending || rolledOver}
              onClick={() => rollover.mutate()}
              data-testid="sprint-close-rollover"
            >
              {rolledOver
                ? 'Rolled over'
                : `Move ${summary.slippedTaskIds.length} slipped into Sprint ${nextSprintNumber}`}
            </Button>
          ) : null}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-foreground">{value}</dd>
    </div>
  );
}
