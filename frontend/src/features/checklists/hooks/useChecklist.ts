import { useQuery } from '@tanstack/react-query';
import { checklistsHttp } from '@/lib/http/checklists';
import { taskKeys } from '@/features/queryKeys';

export function useChecklist(workspaceSlug: string, projectSlug: string, taskNumber: number) {
  return useQuery({
    queryKey: taskKeys.checklist(workspaceSlug, projectSlug, taskNumber),
    queryFn: () => checklistsHttp.list(workspaceSlug, projectSlug, taskNumber),
    enabled: Boolean(workspaceSlug && projectSlug && Number.isFinite(taskNumber)),
  });
}
