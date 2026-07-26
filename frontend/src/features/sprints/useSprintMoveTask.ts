'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sprintsHttp } from '@/lib/http/sprints';
import { sprintKeys, taskKeys } from '@/features/queryKeys';

export interface UseSprintMoveTaskInput {
  workspaceSlug: string;
  projectSlug: string;
  sprintNumber: number;
}

export interface SprintMoveMutationInput {
  add: string[];
  remove: string[];
}

/**
 * Wraps `POST /sprints/:n/tasks` for the two-pane planner.
 *
 * The optimistic update lives INSIDE the component that owns the planner
 * state (see `SprintPlanner.tsx` → local reducer). This hook only handles
 * the round-trip and cache invalidation: on success, both the sprint
 * detail query and the enclosing task list queries need to be marked
 * stale so the next render pulls the server-authoritative sprintId
 * assignments.
 */
export function useSprintMoveTask(input: UseSprintMoveTaskInput) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SprintMoveMutationInput) => {
      const idempotencyKey = crypto.randomUUID();
      await sprintsHttp.mutateTasks(
        input.workspaceSlug,
        input.projectSlug,
        input.sprintNumber,
        payload,
        idempotencyKey,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: sprintKeys.detail(input.workspaceSlug, input.projectSlug, input.sprintNumber),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.all(input.workspaceSlug, input.projectSlug),
        }),
      ]);
    },
  });
}
