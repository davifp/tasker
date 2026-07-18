import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsHttp } from '@/lib/http/projects';
import { projectKeys } from '@/features/queryKeys';
import type { CursorPage, Project } from '@/lib/http/types';

interface Variables {
  projectSlug: string;
}

interface Snapshot {
  detail?: Project;
  lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Project> | undefined }>;
}

export interface DeleteProjectWithUndoResult {
  undo(): Promise<Project | void>;
}

// Two-step optimistic delete:
//  1. Server soft-deletes; hook removes the project from every list cache.
//  2. Caller shows an undo toast for ~30s and, if pressed, invokes
//     `undo()`, which hits `POST /restore` and re-inserts the row on
//     success (invalidation refreshes the sort order).
export function useDeleteProjectWithUndo(workspaceSlug: string): {
  mutate: (vars: Variables) => Promise<DeleteProjectWithUndoResult>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, unknown, Variables, Snapshot>({
    mutationFn: ({ projectSlug }) => projectsHttp.remove(workspaceSlug, projectSlug),
    async onMutate({ projectSlug }) {
      await queryClient.cancelQueries({ queryKey: projectKeys.all(workspaceSlug) });

      const detailKey = projectKeys.detail(workspaceSlug, projectSlug);
      const detail = queryClient.getQueryData<Project>(detailKey);

      const lists = queryClient.getQueriesData<CursorPage<Project>>({
        queryKey: [...projectKeys.all(workspaceSlug), 'list'],
      });

      queryClient.removeQueries({ queryKey: detailKey });
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Project>>(key, {
          ...page,
          items: page.items.filter((p) => p.slug !== projectSlug),
        });
      }

      return { detail, lists: lists.map(([queryKey, data]) => ({ queryKey, data })) };
    },
    onError(_err, _vars, snapshot) {
      if (!snapshot) return;
      if (snapshot.detail) {
        queryClient.setQueryData(
          projectKeys.detail(workspaceSlug, snapshot.detail.slug),
          snapshot.detail,
        );
      }
      for (const entry of snapshot.lists) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceSlug) });
    },
  });

  return {
    isPending: mutation.isPending,
    async mutate({ projectSlug }) {
      await mutation.mutateAsync({ projectSlug });
      return {
        undo: async () => {
          const restored = await projectsHttp.restore(workspaceSlug, projectSlug);
          void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceSlug) });
          return restored;
        },
      };
    },
  };
}
