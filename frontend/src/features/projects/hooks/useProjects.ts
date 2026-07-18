import { useQuery } from '@tanstack/react-query';
import { projectsHttp, type ListProjectsInput } from '@/lib/http/projects';
import { projectKeys } from '@/features/queryKeys';

export function useProjects(workspaceSlug: string, filters: ListProjectsInput = {}) {
  return useQuery({
    queryKey: projectKeys.list(workspaceSlug, {
      status: filters.status,
      includeDeleted: filters.includeDeleted,
    }),
    queryFn: () => projectsHttp.list(workspaceSlug, filters),
    enabled: Boolean(workspaceSlug),
  });
}

export function useProject(workspaceSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: projectKeys.detail(workspaceSlug, projectSlug),
    queryFn: () => projectsHttp.findBySlug(workspaceSlug, projectSlug),
    enabled: Boolean(workspaceSlug && projectSlug),
  });
}
