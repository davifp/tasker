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

// Archive is modeled as a status patch (ACTIVE → ARCHIVED) rather than a
// delete. Optimistically updates the detail cache and every "projects" list
// query in one pass.
export function useArchiveProject(workspaceSlug: string) {
  const queryClient = useQueryClient();

  return useMutation<Project, unknown, Variables, Snapshot>({
    mutationFn: ({ projectSlug }) =>
      projectsHttp.update(workspaceSlug, projectSlug, { status: 'ARCHIVED' }),
    async onMutate({ projectSlug }) {
      await queryClient.cancelQueries({ queryKey: projectKeys.all(workspaceSlug) });

      const detailKey = projectKeys.detail(workspaceSlug, projectSlug);
      const detail = queryClient.getQueryData<Project>(detailKey);

      const lists = queryClient.getQueriesData<CursorPage<Project>>({
        queryKey: [...projectKeys.all(workspaceSlug), 'list'],
      });

      if (detail) {
        queryClient.setQueryData<Project>(detailKey, { ...detail, status: 'ARCHIVED' });
      }
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Project>>(key, {
          ...page,
          items: page.items.map((p) => (p.slug === projectSlug ? { ...p, status: 'ARCHIVED' } : p)),
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
}
