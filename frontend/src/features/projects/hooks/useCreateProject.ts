import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsHttp, type CreateProjectInput } from '@/lib/http/projects';
import { projectKeys } from '@/features/queryKeys';
import type { Project } from '@/lib/http/types';

export function useCreateProject(workspaceSlug: string) {
  const queryClient = useQueryClient();

  return useMutation<Project, unknown, CreateProjectInput>({
    mutationFn: (input) => projectsHttp.create(workspaceSlug, input, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceSlug) });
    },
  });
}
