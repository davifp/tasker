'use client';

import { useContext, createContext } from 'react';
import { useWorkspaceMembers } from './useWorkspaceMembers';

// Explicit workspace-slug context so leaf components rendered anywhere
// under the workspace layout can resolve member display names without the
// slug being prop-drilled all the way down.
const WorkspaceSlugContext = createContext<string | null>(null);

export function WorkspaceSlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return <WorkspaceSlugContext.Provider value={slug}>{children}</WorkspaceSlugContext.Provider>;
}

export function useMemberDisplayName(userId: string | null | undefined): string | null {
  const slug = useContext(WorkspaceSlugContext);
  const members = useWorkspaceMembers(slug ?? '');
  if (!userId || !slug) return null;
  return members.data?.find((m) => m.userId === userId)?.displayName ?? null;
}
