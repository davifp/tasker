'use client';

import { useMemo, useState } from 'react';
import { DndContext, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { WorkspaceRole } from '@/lib/http/types';
import { epicsHttp, roadmapHttp, type Epic } from '@/lib/http/epics';
import { HttpError } from '@/lib/http/errors';
import { epicKeys } from '@/features/queryKeys';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EpicBar } from './EpicBar';
import { EpicDialog } from './EpicDialog';
import { quarterOrdinal, shiftQuarter } from './quarter-range';

export interface RoadmapBoardProps {
  workspaceSlug: string;
  projectSlug: string;
  currentUserRole: WorkspaceRole;
  quarters: string[];
  initialEpics: Epic[];
}

export function RoadmapBoard({
  workspaceSlug,
  projectSlug,
  currentUserRole,
  quarters,
  initialEpics,
}: RoadmapBoardProps): React.JSX.Element {
  const [dialogState, setDialogState] = useState<{ open: boolean; epic: Epic | null }>({
    open: false,
    epic: null,
  });

  const readOnly = currentUserRole !== 'OWNER' && currentUserRole !== 'ADMIN';
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: epicKeys.roadmap(workspaceSlug, {
      fromQuarter: quarters[0],
      toQuarter: quarters[quarters.length - 1],
    }),
    queryFn: () =>
      roadmapHttp.list(workspaceSlug, {
        fromQuarter: quarters[0],
        toQuarter: quarters[quarters.length - 1],
      }),
    initialData: { items: initialEpics },
  });

  const reposition = useMutation({
    mutationFn: async (input: { epicId: string; startQuarter: string; endQuarter: string }) => {
      return epicsHttp.update(workspaceSlug, input.epicId, {
        startQuarter: input.startQuarter,
        endQuarter: input.endQuarter,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: epicKeys.all(workspaceSlug) });
    },
    onError: (err) => {
      const message =
        err instanceof HttpError ? (err.detail ?? err.title ?? err.message) : 'Move failed';
      toast.error(message);
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    if (readOnly) return;
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const epic = data.items.find((e) => e.id === event.active.id);
    if (!epic) return;
    const targetStart = overId; // droppable id is the target quarter id
    if (targetStart === epic.startQuarter) return;
    const delta = quarterOrdinal(targetStart) - quarterOrdinal(epic.startQuarter);
    reposition.mutate({
      epicId: epic.id,
      startQuarter: targetStart,
      endQuarter: shiftQuarter(epic.endQuarter, delta),
    });
  };

  const epicsByRow = useMemo(() => layoutEpicRows(data.items), [data.items]);

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {quarters.length} quarter{quarters.length === 1 ? '' : 's'} · {data.items.length} epic
            {data.items.length === 1 ? '' : 's'}
          </p>
          {readOnly ? (
            <p className="text-xs text-muted-foreground" role="status">
              Read-only — only Owners and Admins can edit the roadmap.
            </p>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogState({ open: true, epic: null })}
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden /> New epic
            </Button>
          )}
        </div>
        <RoadmapGrid quarters={quarters}>
          {epicsByRow.length === 0 ? (
            <p
              className="col-span-full rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
              data-testid="roadmap-empty"
            >
              No epics in this window. Create one to start planning quarters.
            </p>
          ) : (
            epicsByRow.map((row, rowIdx) => (
              <div
                key={`row-${rowIdx}`}
                className="col-span-full grid gap-1"
                style={{ gridTemplateColumns: `repeat(${quarters.length}, minmax(0, 1fr))` }}
              >
                {row.map((epic) => (
                  <EpicBar
                    key={epic.id}
                    epic={epic}
                    gridStart={quarters[0]!}
                    readOnly={readOnly}
                    onEdit={(e) => setDialogState({ open: true, epic: e })}
                  />
                ))}
              </div>
            ))
          )}
        </RoadmapGrid>
      </div>
      <EpicDialog
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        epic={dialogState.epic}
        open={dialogState.open}
        onOpenChange={(open) => setDialogState({ open, epic: open ? dialogState.epic : null })}
      />
    </DndContext>
  );
}

function RoadmapGrid({ quarters, children }: { quarters: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${quarters.length}, minmax(0, 1fr))` }}
      >
        {quarters.map((q) => (
          <div key={q} className="text-center text-xs font-medium text-muted-foreground">
            {q}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2">
        {children}
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${quarters.length}, minmax(0, 1fr))` }}
        >
          {quarters.map((q) => (
            <QuarterDropCell key={`drop-${q}`} quarterId={q} />
          ))}
        </div>
      </div>
    </div>
  );
}

function QuarterDropCell({ quarterId }: { quarterId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: quarterId });
  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={`Drop zone for ${quarterId}`}
      className={cn(
        'h-8 rounded border border-dashed border-transparent',
        isOver && 'border-primary bg-primary/5',
      )}
    />
  );
}

/**
 * Greedy row packer: places each epic into the first row where its column
 * range does not intersect an existing bar. Keeps bars from stacking on
 * top of one another without an expensive interval-tree layout.
 */
function layoutEpicRows(epics: Epic[]): Epic[][] {
  const rows: Epic[][] = [];
  const sorted = [...epics].sort(
    (a, b) => quarterOrdinal(a.startQuarter) - quarterOrdinal(b.startQuarter),
  );
  for (const epic of sorted) {
    let placed = false;
    for (const row of rows) {
      const overlaps = row.some(
        (other) =>
          quarterOrdinal(epic.startQuarter) <= quarterOrdinal(other.endQuarter) &&
          quarterOrdinal(epic.endQuarter) >= quarterOrdinal(other.startQuarter),
      );
      if (!overlaps) {
        row.push(epic);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([epic]);
  }
  return rows;
}
