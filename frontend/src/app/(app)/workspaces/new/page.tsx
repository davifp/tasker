import { getTranslations } from 'next-intl/server';
import { requireVerified } from '@/lib/session/require';
import { CreateWorkspaceForm } from '@/features/workspace/CreateWorkspaceForm';
import { MAIN_CONTENT_ID } from '@/components/shell/SkipToContent';

export default async function CreateWorkspacePage() {
  await requireVerified();

  const t = await getTranslations('workspace.create');

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12"
    >
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="mt-8">
        <CreateWorkspaceForm />
      </div>
    </main>
  );
}
