import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session/require';
import { serverHttp } from '@/lib/http/server';
import { MembersTable, type WorkspaceMember } from '@/features/members/MembersTable';
import {
  PendingInvitationsList,
  type PendingInvitation,
} from '@/features/members/PendingInvitationsList';
import { InvitePeopleDialog } from '@/features/members/InvitePeopleDialog';
import { canManageMembers, type MemberRoleValue } from '@/features/members/schemas';
import { Separator } from '@/components/ui/separator';

interface MembersPageProps {
  params: Promise<{ workspace: string }>;
}

interface WorkspaceDetail {
  id: string;
  currentUserRole?: MemberRoleValue;
}

async function fetchWorkspaceDetail(slug: string): Promise<WorkspaceDetail | null> {
  try {
    return await serverHttp.get<WorkspaceDetail>(`/api/v1/workspaces/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

async function fetchMembers(slug: string): Promise<WorkspaceMember[]> {
  try {
    const raw = await serverHttp.get<WorkspaceMember[] | { items?: WorkspaceMember[] }>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}/members`,
    );
    return Array.isArray(raw) ? raw : (raw.items ?? []);
  } catch {
    return [];
  }
}

async function fetchInvitations(slug: string): Promise<PendingInvitation[]> {
  try {
    const raw = await serverHttp.get<PendingInvitation[] | { items?: PendingInvitation[] }>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}/invitations`,
    );
    return Array.isArray(raw) ? raw : (raw.items ?? []);
  } catch {
    return [];
  }
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { workspace: slug } = await params;
  await requireSession();
  const t = await getTranslations('members');

  const [detail, members, invitations] = await Promise.all([
    fetchWorkspaceDetail(slug),
    fetchMembers(slug),
    fetchInvitations(slug),
  ]);

  const actorRole = detail?.currentUserRole;
  const canManage = canManageMembers(actorRole);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {canManage ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t('inviteHeading')}</h2>
          <InvitePeopleDialog slug={slug} workspaceId={detail?.id} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t('membersHeading')}</h2>
        <MembersTable
          slug={slug}
          members={members}
          actorRole={actorRole}
          workspaceId={detail?.id}
        />
      </section>

      {invitations.length > 0 || canManage ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{t('pendingHeading')}</h2>
            <PendingInvitationsList slug={slug} invitations={invitations} canManage={canManage} />
          </section>
        </>
      ) : null}
    </div>
  );
}
