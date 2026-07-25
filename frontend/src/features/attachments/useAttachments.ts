import { useQuery } from '@tanstack/react-query';
import { taskKeys } from '@/features/queryKeys';
import { attachmentsHttp } from '@/lib/http/attachments';

export function useAttachments(input: {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: taskKeys.attachments(input.workspaceSlug, input.projectSlug, input.taskNumber),
    queryFn: () => attachmentsHttp.list(input.workspaceSlug, input.projectSlug, input.taskNumber),
    enabled: input.enabled ?? true,
    staleTime: 15_000,
  });
}
