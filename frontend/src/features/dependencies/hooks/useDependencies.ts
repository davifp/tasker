import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dependenciesHttp } from '@/lib/http/dependencies';
import { taskKeys } from '@/features/queryKeys';
import type { TaskDependency } from '@/lib/http/types';

interface Coords {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

export function useDependencies({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  return useQuery({
    queryKey: taskKeys.dependencies(workspaceSlug, projectSlug, taskNumber),
    queryFn: () => dependenciesHttp.list(workspaceSlug, projectSlug, taskNumber),
    enabled: Boolean(workspaceSlug && projectSlug && Number.isFinite(taskNumber)),
  });
}

// The techspec calls this `useSetDependencies`, but the write surface is
// really two mutually-exclusive intents: add one edge, remove one edge.
// The board-side helper composes both when the user reassigns blockers.

export function useAddDependency({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.dependencies(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    TaskDependency,
    unknown,
    { blockedByTaskId: string },
    { previous: TaskDependency[] | undefined }
  >({
    mutationFn: ({ blockedByTaskId }) =>
      dependenciesHttp.add(workspaceSlug, projectSlug, taskNumber, { blockedByTaskId }),
    async onMutate({ blockedByTaskId }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskDependency[]>(key);
      queryClient.setQueryData<TaskDependency[]>(key, [
        ...(previous ?? []),
        { taskId: '', blockedByTaskId },
      ]);
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRemoveDependency({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.dependencies(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    void,
    unknown,
    { blockerId: string },
    { previous: TaskDependency[] | undefined }
  >({
    mutationFn: ({ blockerId }) =>
      dependenciesHttp.remove(workspaceSlug, projectSlug, taskNumber, blockerId),
    async onMutate({ blockerId }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskDependency[]>(key);
      if (previous) {
        queryClient.setQueryData<TaskDependency[]>(
          key,
          previous.filter((d) => d.blockedByTaskId !== blockerId),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
