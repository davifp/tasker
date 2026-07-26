import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session/require';
import { serverHttp } from '@/lib/http/server';
import { fromUrl } from '@/features/audit/auditParams';
import { AuditTable } from '@/features/audit/AuditTable';

interface WorkspaceDetail {
  currentUserRole?: string;
}

function isAdminOrOwner(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Audit viewer. Server component performs the role check up front so we never
 * render the interactive table for members. If the caller lacks permissions,
 * we render an inline 403 message instead of a broken data view.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspace: slug }, sp] = await Promise.all([params, searchParams]);
  await requireSession();
  const t = await getTranslations('audit.page');

  let detail: WorkspaceDetail;
  try {
    detail = await serverHttp.get<WorkspaceDetail>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}`,
    );
  } catch {
    notFound();
  }

  if (!isAdminOrOwner(detail.currentUserRole)) {
    return (
      <section className="flex flex-col gap-3">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        </header>
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">{t('forbiddenTitle')}</p>
          <p className="mt-1">{t('forbiddenBody')}</p>
        </div>
      </section>
    );
  }

  const parsed = fromUrl(sp);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <AuditTable workspaceSlug={slug} params={parsed} />
    </section>
  );
}
