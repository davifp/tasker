import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session/require';
import { serverHttp } from '@/lib/http/server';
import { WorkspaceSettingsForm } from '@/features/workspace/WorkspaceSettingsForm';
import { DeleteWorkspaceDialog } from '@/features/workspace/DeleteWorkspaceDialog';
import {
  TransferOwnershipDialog,
  type AdminCandidate,
} from '@/features/workspace/TransferOwnershipDialog';
import {
  DeletedWorkspacesList,
  type DeletedWorkspace,
} from '@/features/workspace/DeletedWorkspacesList';
import { Separator } from '@/components/ui/separator';

interface SettingsPageProps {
  params: Promise<{ workspace: string }>;
}

interface WorkspaceDetail {
  id: string;
  slug: string;
  name: string;
  currentUserRole?: string;
}

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

function isOwner(role: string | undefined): boolean {
  return role === 'OWNER';
}
function canEdit(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

async function loadAdmins(slug: string): Promise<AdminCandidate[]> {
  try {
    const members = await serverHttp.get<Member[] | { items?: Member[] }>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}/members`,
    );
    const list = Array.isArray(members) ? members : (members.items ?? []);
    return list
      .filter((member) => member.role === 'ADMIN')
      .map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
      }));
  } catch {
    return [];
  }
}

async function loadDeletedWorkspaces(): Promise<DeletedWorkspace[]> {
  try {
    const raw = await serverHttp.get<{ items?: DeletedWorkspace[] } | DeletedWorkspace[]>(
      '/api/v1/me/workspaces?state=deleted',
    );
    return Array.isArray(raw) ? raw : (raw.items ?? []);
  } catch {
    return [];
  }
}

export default async function WorkspaceSettingsPage({ params }: SettingsPageProps) {
  const { workspace: slug } = await params;
  await requireSession();

  const t = await getTranslations('workspace.settings');

  let detail: WorkspaceDetail;
  try {
    detail = await serverHttp.get<WorkspaceDetail>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}`,
    );
  } catch {
    notFound();
  }

  const role = detail.currentUserRole;
  const editing = canEdit(role);
  const owning = isOwner(role);

  const [admins, deletedWorkspaces] = await Promise.all([
    owning ? loadAdmins(slug) : Promise.resolve([]),
    owning ? loadDeletedWorkspaces() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{t('generalTitle')}</h2>
        <WorkspaceSettingsForm slug={slug} name={detail.name} canEdit={editing} />
      </section>

      {owning ? (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold">{t('transferTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('transferBody')}</p>
            </div>
            <TransferOwnershipDialog slug={slug} admins={admins} />
          </section>
          <Separator />
          <section className="flex flex-col gap-4 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div>
              <h2 className="text-base font-semibold text-destructive">{t('dangerTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('dangerBody')}</p>
            </div>
            <DeleteWorkspaceDialog slug={slug} name={detail.name} />
          </section>
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{t('deletedTitle')}</h2>
            <DeletedWorkspacesList workspaces={deletedWorkspaces} />
          </section>
        </>
      ) : null}
    </div>
  );
}
