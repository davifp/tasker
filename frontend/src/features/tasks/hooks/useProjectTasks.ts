import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { tasksHttp, type ListTasksInput } from '@/lib/http/tasks';
import { taskKeys, type TaskFilters } from '@/features/queryKeys';
import type { CursorPage, Task } from '@/lib/http/types';

interface UseProjectTasksOptions {
  // Cursor-pagination knobs are transport concerns, not filter identity.
  // They pass straight through to the HTTP layer but do NOT participate
  // in the cache key — the four views share the first page via the
  // canonical `taskKeys.list` key, then each fetches its own cursor
  // continuation if the number of tasks warrants it.
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
}

/**
 * Canonical read hook for the four project views. Every view mounted
 * with the same filter set reads the same TanStack Query cache entry
 * (see `canonicalize` in `queryKeys.ts`), so switching views does not
 * re-fetch. Returns the same `CursorPage<Task>` shape the previous
 * board hook returned so callers can migrate without adapter code.
 */
export function useProjectTasks(
  workspaceSlug: string,
  projectSlug: string,
  filters: TaskFilters,
  options: UseProjectTasksOptions = {},
): UseQueryResult<CursorPage<Task>> {
  return useQuery({
    queryKey: taskKeys.list(workspaceSlug, projectSlug, filters),
    queryFn: () => {
      const wire: ListTasksInput = {
        ...(filters.assigneeUserId
          ? { assigneeUserId: filters.assigneeUserId }
          : {}),
        ...(filters.labelIds && filters.labelIds.length > 0
          ? { labelIds: filters.labelIds }
          : {}),
        ...(filters.status && filters.status.length > 0
          ? { status: filters.status }
          : {}),
        ...(filters.priority && filters.priority.length > 0
          ? { priority: filters.priority }
          : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.sort ? { sort: filters.sort } : {}),
        ...(filters.sortDir ? { sortDir: filters.sortDir } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        ...(options.includeDeleted !== undefined
          ? { includeDeleted: options.includeDeleted }
          : {}),
      };
      return tasksHttp.list(workspaceSlug, projectSlug, wire);
    },
    enabled: Boolean(workspaceSlug && projectSlug),
  });
}
