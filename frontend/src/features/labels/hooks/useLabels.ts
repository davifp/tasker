import { useQuery } from '@tanstack/react-query';
import { labelsHttp, type ListLabelsInput } from '@/lib/http/labels';
import { labelKeys } from '@/features/queryKeys';

export function useLabels(workspaceSlug: string, input: ListLabelsInput = {}) {
  return useQuery({
    queryKey: labelKeys.list(workspaceSlug),
    queryFn: () => labelsHttp.list(workspaceSlug, input),
    enabled: Boolean(workspaceSlug),
    staleTime: 2 * 60 * 1000,
  });
}
