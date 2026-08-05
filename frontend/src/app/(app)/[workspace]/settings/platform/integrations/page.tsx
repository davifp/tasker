import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IntegrationsView } from '@/features/platform/integrations/IntegrationsView';
import { serverHttp } from '@/lib/http/server';
import { requireSession } from '@/lib/session/require';

interface WorkspaceDetail {
  currentUserRole?: string;
}

function canManage(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const [{ workspace: slug }, t] = await Promise.all([
    params,
    getTranslations('platform.integrations'),
  ]);
  await requireSession();

  let detail: WorkspaceDetail;
  try {
    detail = await serverHttp.get<WorkspaceDetail>(
      `/api/v1/workspaces/${encodeURIComponent(slug)}`,
    );
  } catch {
    notFound();
  }

  if (!canManage(detail.currentUserRole)) {
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

  return (
    <section className="flex flex-col gap-6">
      <IntegrationsView workspaceSlug={slug} canManage />
    </section>
  );
}
