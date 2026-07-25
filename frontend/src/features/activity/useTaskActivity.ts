import { useInfiniteQuery } from '@tanstack/react-query';
import { taskKeys } from '@/features/queryKeys';
import { activityHttp } from '@/lib/http/activity';
import type { Activity, CursorPage } from '@/lib/http/types';

export function useTaskActivity(input: {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  enabled?: boolean;
  pageLimit?: number;
}) {
  return useInfiniteQuery<CursorPage<Activity>, unknown>({
    queryKey: taskKeys.activity(input.workspaceSlug, input.projectSlug, input.taskNumber),
    queryFn: ({ pageParam }) =>
      activityHttp.forTask(input.workspaceSlug, input.projectSlug, input.taskNumber, {
        cursor: typeof pageParam === 'string' ? pageParam : undefined,
        limit: input.pageLimit ?? 30,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: input.enabled ?? true,
    staleTime: 15_000,
  });
}
