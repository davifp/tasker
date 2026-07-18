import { useQuery } from '@tanstack/react-query';
import { commentsHttp } from '@/lib/http/comments';
import { taskKeys } from '@/features/queryKeys';

export function useComments(workspaceSlug: string, projectSlug: string, taskNumber: number) {
  return useQuery({
    queryKey: taskKeys.comments(workspaceSlug, projectSlug, taskNumber),
    queryFn: () => commentsHttp.list(workspaceSlug, projectSlug, taskNumber),
    enabled: Boolean(workspaceSlug && projectSlug && Number.isFinite(taskNumber)),
  });
}
