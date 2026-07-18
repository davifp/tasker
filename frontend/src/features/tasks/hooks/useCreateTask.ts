import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksHttp, type CreateTaskInput } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';
import type { Task } from '@/lib/http/types';

export function useCreateTask(workspaceSlug: string, projectSlug: string) {
  const queryClient = useQueryClient();
  return useMutation<Task, unknown, CreateTaskInput>({
    mutationFn: (input) =>
      tasksHttp.create(workspaceSlug, projectSlug, input, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceSlug, projectSlug) });
    },
  });
}
