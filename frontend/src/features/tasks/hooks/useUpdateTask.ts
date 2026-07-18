import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksHttp, type UpdateTaskInput } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

interface Variables {
  number: number;
  patch: UpdateTaskInput;
}

interface Snapshot {
  detail?: Task;
  lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Task> | undefined }>;
}

// Standard optimistic patch: snapshot detail + every list slice under the
// task's workspace/project scope, apply the field-level patch locally,
// roll back on error, invalidate on settle.
export function useUpdateTask(workspaceSlug: string, projectSlug: string) {
  const queryClient = useQueryClient();

  return useMutation<Task, unknown, Variables, Snapshot>({
    mutationFn: ({ number, patch }) => tasksHttp.update(workspaceSlug, projectSlug, number, patch),
    async onMutate({ number, patch }) {
      await queryClient.cancelQueries({ queryKey: taskKeys.all(workspaceSlug, projectSlug) });

      const detailKey = taskKeys.detail(workspaceSlug, projectSlug, number);
      const detail = queryClient.getQueryData<Task>(detailKey);

      const lists = queryClient.getQueriesData<CursorPage<Task>>({
        queryKey: [...taskKeys.all(workspaceSlug, projectSlug), 'list'],
      });

      if (detail) {
        queryClient.setQueryData<Task>(detailKey, mergeTaskPatch(detail, patch));
      }
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Task>>(key, {
          ...page,
          items: page.items.map((t) => (t.number === number ? mergeTaskPatch(t, patch) : t)),
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

function mergeTaskPatch(task: Task, patch: UpdateTaskInput): Task {
  return {
    ...task,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
  };
}
