import { useQuery } from '@tanstack/react-query';
import { tasksHttp } from '@/lib/http/tasks';
import { taskKeys } from '@/features/queryKeys';

/**
 * Singular task-detail hook. The plural list hook lives in
 * `./useProjectTasks` and consumes the canonical `TaskFilters` shape so
 * every view shares a single cache entry per project.
 */
export function useTask(workspaceSlug: string, projectSlug: string, number: number) {
  return useQuery({
    queryKey: taskKeys.detail(workspaceSlug, projectSlug, number),
    queryFn: () => tasksHttp.findByNumber(workspaceSlug, projectSlug, number),
    enabled: Boolean(workspaceSlug && projectSlug && Number.isFinite(number)),
  });
}
