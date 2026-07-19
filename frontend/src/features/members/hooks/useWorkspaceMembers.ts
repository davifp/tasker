'use client';

import { useQuery } from '@tanstack/react-query';
import { browserHttp } from '@/lib/http/browser';

export interface WorkspaceMemberSummary {
  userId: string;
  displayName: string;
  email: string;
  role: string;
}

interface BackendMember {
  id: string;
  role: string;
  user: { id: string; displayName: string; email: string };
}

async function fetchWorkspaceMembers(slug: string): Promise<WorkspaceMemberSummary[]> {
  // `limit=200` covers well beyond a Kanban-filter-realistic team size
  // (single page). Cursor pagination on top can land later if this grows.
  const raw = await browserHttp.get<BackendMember[] | { items?: BackendMember[] }>(
    `/workspaces/${encodeURIComponent(slug)}/members?limit=200`,
  );
  const items = Array.isArray(raw) ? raw : (raw.items ?? []);
  return items.map((member) => ({
    userId: member.user.id,
    displayName: member.user.displayName,
    email: member.user.email,
    role: member.role,
  }));
}

const membersKeys = {
  list: (slug: string) => ['workspace-members', slug, 'list'] as const,
};

export function useWorkspaceMembers(workspaceSlug: string) {
  return useQuery({
    queryKey: membersKeys.list(workspaceSlug),
    queryFn: () => fetchWorkspaceMembers(workspaceSlug),
    enabled: Boolean(workspaceSlug),
    staleTime: 60_000,
  });
}
