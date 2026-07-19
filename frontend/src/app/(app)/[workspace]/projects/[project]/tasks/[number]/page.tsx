import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession, fetchMyWorkspaces } from '@/lib/session/require';
import { serverHttp } from '@/lib/http/server';
import { HttpError } from '@/lib/http/errors';
import type { Project, Task, WorkspaceRole } from '@/lib/http/types';
import { KanbanBoard } from '@/features/tasks/KanbanBoard';

interface DeepLinkPageProps {
  params: Promise<{ workspace: string; project: string; number: string }>;
}

async function fetchProject(workspaceSlug: string, projectSlug: string): Promise<Project | null> {
  try {
    return await serverHttp.get<Project>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function fetchTask(
  workspaceSlug: string,
  projectSlug: string,
  number: number,
): Promise<Task | null> {
  try {
    return await serverHttp.get<Task>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${number}`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

function parseTaskNumber(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) return null;
  return n;
}

export default async function TaskDeepLinkPage({ params }: DeepLinkPageProps) {
  const { workspace: workspaceSlug, project: projectSlug, number } = await params;
  const parsedNumber = parseTaskNumber(number);
  const session = await requireSession();
  const [project, workspaces] = await Promise.all([
    fetchProject(workspaceSlug, projectSlug),
    fetchMyWorkspaces(session.accessToken),
  ]);
  if (!project) notFound();
  const active = workspaces.find((membership) => membership.slug === workspaceSlug);
  if (!active) notFound();
  const role = (active.role ?? 'MEMBER') as WorkspaceRole;

  if (parsedNumber === null) {
    return (
      <TaskNotFound workspaceSlug={workspaceSlug} projectSlug={projectSlug} number={number} />
    );
  }
  const task = await fetchTask(workspaceSlug, projectSlug, parsedNumber);
  if (!task) {
    return (
      <TaskNotFound
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        number={String(parsedNumber)}
      />
    );
  }

  return (
    <KanbanBoard
      workspaceSlug={workspaceSlug}
      workspaceId={active.id}
      projectSlug={projectSlug}
      projectId={project.id}
      currentUserId={session.userId}
      currentUserRole={role}
      initialTaskNumber={parsedNumber}
    />
  );
}

interface TaskNotFoundProps {
  workspaceSlug: string;
  projectSlug: string;
  number: string;
}

async function TaskNotFound({ workspaceSlug, projectSlug, number }: TaskNotFoundProps) {
  const t = await getTranslations('board.deepLink.notFound');
  return (
    <div
      role="alert"
      className="mx-auto mt-6 flex max-w-md flex-col items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-6"
    >
      <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('body', { number })}</p>
      <Link
        href={`/${workspaceSlug}/projects/${projectSlug}/board`}
        className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('back')}
      </Link>
    </div>
  );
}
