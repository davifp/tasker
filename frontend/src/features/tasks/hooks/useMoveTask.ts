import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksHttp, type MoveTaskInput } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';
import { HttpError } from '@/lib/http/errors';
import { Positions } from '@/lib/ordering/positions';
import type { CursorPage, MoveTaskResponse, Task, TaskStatus } from '@/lib/http/types';

// Custom Problem Details type surfaced when the server accepts the move
// but keeps the task in its original column because the target column is
// `DONE` and open blockers exist. We throw this from the mutation so the
// standard `onError` rollback path fires; the caller catches it, presents
// the blocker AlertDialog, and re-invokes the mutation with
// `overrideBlockers: true`.
export const BLOCKERS_OPEN_PROBLEM = 'https://tasker.dev/problems/blockers-open';

export class BlockersOpenError extends HttpError {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super({
      type: BLOCKERS_OPEN_PROBLEM,
      title: 'Blocked by open dependencies',
      status: 200,
      detail: 'The task cannot be completed while blockers are open.',
    });
    this.name = 'BlockersOpenError';
    this.blockers = blockers;
  }
}

interface Variables extends MoveTaskInput {
  number: number;
  // Neighbour position keys around the intended drop slot at drag time.
  // On a 409 `position-conflict` we recompute `Positions.between` from the
  // freshest cached snapshot rather than blindly appending to the tail,
  // preserving the user's intended drop index.
  targetBefore: string | null;
  targetAfter: string | null;
  targetStatus: TaskStatus;
}

interface Snapshot {
  detail?: Task;
  lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Task> | undefined }>;
}

// Optimistic Kanban move. Snapshots the current state, applies the new
// status + position locally, rolls back on error. A 409
// `position-conflict` from the server triggers exactly one client-side
// retry with a freshly generated key; the second failure is surfaced to
// the caller so the toast can render the Problem Details.
export function useMoveTask(workspaceSlug: string, projectSlug: string) {
  const queryClient = useQueryClient();

  return useMutation<MoveTaskResponse, unknown, Variables, Snapshot>({
    mutationFn: async ({ number, targetBefore, targetAfter, targetStatus, ...input }) => {
      // First attempt with the intended position key.
      let response: MoveTaskResponse;
      try {
        response = await tasksHttp.move(workspaceSlug, projectSlug, number, input);
      } catch (err) {
        if (
          err instanceof HttpError &&
          err.type === 'https://tasker.dev/problems/position-conflict'
        ) {
          // Recompute from the freshest cached list slice — this preserves
          // the intended drop index rather than dumping the card at the
          // column tail.
          const lists = queryClient.getQueriesData<CursorPage<Task>>({
            queryKey: [...taskKeys.all(workspaceSlug, projectSlug), 'list'],
          });
          let before = targetBefore;
          let after = targetAfter;
          for (const [, page] of lists) {
            if (!page) continue;
            const column = page.items
              .filter((t) => t.status === targetStatus && t.number !== number)
              .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
            const idxBefore = before
              ? column.findIndex((t) => t.position === before)
              : -1;
            const idxAfter = after ? column.findIndex((t) => t.position === after) : -1;
            if (idxBefore >= 0) before = column[idxBefore]?.position ?? before;
            if (idxAfter >= 0) after = column[idxAfter]?.position ?? after;
          }
          const fresh = Positions.between(before, after);
          response = await tasksHttp.move(workspaceSlug, projectSlug, number, {
            ...input,
            position: fresh,
          });
        } else {
          throw err;
        }
      }
      // Blocker-open branch: server responded 200 but did NOT apply the
      // move. Throw a synthetic error so the standard onError rollback
      // path restores the optimistic patch. The caller re-invokes the
      // mutation with `overrideBlockers: true` after the AlertDialog
      // confirms.
      if (
        !input.overrideBlockers &&
        response.acknowledgedBlockersOpen &&
        response.acknowledgedBlockersOpen.length > 0
      ) {
        throw new BlockersOpenError(response.acknowledgedBlockersOpen);
      }
      return response;
    },
    async onMutate({ number, status, position }) {
      await queryClient.cancelQueries({ queryKey: taskKeys.all(workspaceSlug, projectSlug) });

      const detailKey = taskKeys.detail(workspaceSlug, projectSlug, number);
      const detail = queryClient.getQueryData<Task>(detailKey);

      const lists = queryClient.getQueriesData<CursorPage<Task>>({
        queryKey: [...taskKeys.all(workspaceSlug, projectSlug), 'list'],
      });

      if (detail) {
        queryClient.setQueryData<Task>(detailKey, { ...detail, status, position });
      }
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Task>>(key, {
          ...page,
          items: page.items.map((t) => (t.number === number ? { ...t, status, position } : t)),
        });
      }

      return { detail, lists: lists.map(([queryKey, data]) => ({ queryKey, data })) };
    },
    onError(_err, _vars, snapshot) {
      if (!snapshot) return;
      if (snapshot.detail) {
        queryClient.setQueryData(
          taskKeys.detail(workspaceSlug, projectSlug, snapshot.detail.number),
          snapshot.detail,
        );
      }
      for (const entry of snapshot.lists) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    },
    onSettled(_data, _err, { number }) {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.detail(workspaceSlug, projectSlug, number),
      });
      void queryClient.invalidateQueries({
        queryKey: taskKeys.list(workspaceSlug, projectSlug),
      });
    },
  });
}
