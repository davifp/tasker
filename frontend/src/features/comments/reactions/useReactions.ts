import { useQuery } from '@tanstack/react-query';
import { taskKeys } from '@/features/queryKeys';
import { reactionsHttp } from '@/lib/http/reactions';

export function useReactions(input: {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  commentId: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: taskKeys.reactions(
      input.workspaceSlug,
      input.projectSlug,
      input.taskNumber,
      input.commentId,
    ),
    queryFn: () =>
      reactionsHttp.list(input.workspaceSlug, input.projectSlug, input.taskNumber, input.commentId),
    enabled: input.enabled ?? true,
    staleTime: 15_000,
  });
}
