import { getTranslations } from 'next-intl/server';

// Board itself lands in Task 8.0. For now this route only exists so the
// tab remains navigable and layout scaffolding stays stable.
export default async function BoardPage() {
  const t = await getTranslations('projects.placeholders');
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center">
      <p className="text-sm text-muted-foreground">{t('comingSoon')}</p>
    </div>
  );
}
