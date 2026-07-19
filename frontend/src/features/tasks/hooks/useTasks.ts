import { useQuery } from '@tanstack/react-query';
import { tasksHttp, type ListTasksInput } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';

export function useTasks(
  workspaceSlug: string,
  projectSlug: string,
  filters: ListTasksInput = {},
) {
  return useQuery({
    queryKey: taskKeys.list(workspaceSlug, projectSlug, {
      status: filters.status,
      assigneeUserId: filters.assigneeUserId,
      labelId: filters.labelId,
      labelIds: filters.labelIds,
      includeDeleted: filters.includeDeleted,
    }),
    queryFn: () => tasksHttp.list(workspaceSlug, projectSlug, filters),
    enabled: Boolean(workspaceSlug && projectSlug),
  });
}

export function useTask(workspaceSlug: string, projectSlug: string, number: number) {
  return useQuery({
    queryKey: taskKeys.detail(workspaceSlug, projectSlug, number),
    queryFn: () => tasksHttp.findByNumber(workspaceSlug, projectSlug, number),
    enabled: Boolean(workspaceSlug && projectSlug && Number.isFinite(number)),
  });
}
