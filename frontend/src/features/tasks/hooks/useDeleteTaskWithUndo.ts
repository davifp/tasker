import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksHttp } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

interface Variables {
  number: number;
}

interface Snapshot {
  detail?: Task;
  lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Task> | undefined }>;
}

export interface DeleteTaskWithUndoResult {
  undo(): Promise<Task | void>;
}

// Soft-delete with an undo handle. The optimistic pass strips the task
// from every list slice and drops its detail entry; the caller wires an
// undo toast that, when pressed within the 30-second server purge
// window, hits POST /restore and revalidates the caches.
export function useDeleteTaskWithUndo(
  workspaceSlug: string,
  projectSlug: string,
): {
  mutate: (vars: Variables) => Promise<DeleteTaskWithUndoResult>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, unknown, Variables, Snapshot>({
    mutationFn: ({ number }) => tasksHttp.remove(workspaceSlug, projectSlug, number),
    async onMutate({ number }) {
      await queryClient.cancelQueries({ queryKey: taskKeys.all(workspaceSlug, projectSlug) });

      const detailKey = taskKeys.detail(workspaceSlug, projectSlug, number);
      const detail = queryClient.getQueryData<Task>(detailKey);

      const lists = queryClient.getQueriesData<CursorPage<Task>>({
        queryKey: [...taskKeys.all(workspaceSlug, projectSlug), 'list'],
      });

      queryClient.removeQueries({ queryKey: detailKey });
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Task>>(key, {
          ...page,
          items: page.items.filter((t) => t.number !== number),
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

  return {
    isPending: mutation.isPending,
    async mutate({ number }) {
      await mutation.mutateAsync({ number });
      return {
        undo: async () => {
          const restored = await tasksHttp.restore(workspaceSlug, projectSlug, number);
          void queryClient.invalidateQueries({
            queryKey: taskKeys.all(workspaceSlug, projectSlug),
          });
          return restored;
        },
      };
    },
  };
}
