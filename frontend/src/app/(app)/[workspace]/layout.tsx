import { notFound, redirect } from 'next/navigation';
import { requireSession, fetchMe, fetchMyWorkspaces } from '@/lib/session/require';
import { AppShell } from '@/components/shell/AppShell';
import type { WorkspaceRole } from '@/lib/http/types';

const ROLES: readonly WorkspaceRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST', 'DEMO_VIEWER'];
function toWorkspaceRole(value: string | undefined): WorkspaceRole {
  return (ROLES as readonly string[]).includes(value ?? '') ? (value as WorkspaceRole) : 'MEMBER';
}

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { workspace: slug } = await params;
  const session = await requireSession();

  const [user, workspaces] = await Promise.all([
    fetchMe(session.accessToken),
    fetchMyWorkspaces(session.accessToken),
  ]);

  if (!user) redirect('/login');
  if (workspaces.length === 0) redirect('/workspaces/new');

  const active = workspaces.find((membership) => membership.slug === slug);
  if (!active) notFound();

  return (
    <AppShell
      workspaceSlug={slug}
      workspaceId={active.id}
      workspaces={workspaces.map((membership) => ({
        id: membership.id,
        slug: membership.slug,
        name: membership.name,
      }))}
      user={{ name: user.name, email: user.email, emailVerified: user.emailVerified }}
      role={toWorkspaceRole(active.role)}
    >
      {children}
    </AppShell>
  );
}
