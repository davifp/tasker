import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksHttp, type MoveTaskInput } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';
import { HttpError } from '@/lib/http/errors';
import { Positions } from '@/lib/ordering/positions';
import type { CursorPage, MoveTaskResponse, Task } from '@/lib/http/types';

interface Variables extends MoveTaskInput {
  number: number;
  // Kanban callers hand us the current tail of the target column so the
  // retry path can compute a fresh key locally without another server
  // round-trip.
  targetColumnTail: string | null;
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
    mutationFn: async ({ number, targetColumnTail, ...input }) => {
      try {
        return await tasksHttp.move(workspaceSlug, projectSlug, number, input);
      } catch (err) {
        if (
          err instanceof HttpError &&
          err.type === 'https://tasker.dev/problems/position-conflict'
        ) {
          const fresh = Positions.between(targetColumnTail, null);
          return tasksHttp.move(workspaceSlug, projectSlug, number, {
            ...input,
            position: fresh,
          });
        }
        throw err;
      }
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
