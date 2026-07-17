import { getTranslations } from 'next-intl/server';
import { OAuthCompleteController } from '@/features/auth/OAuthCompleteController';

interface OAuthCompletePageProps {
  params: Promise<{ provider: string }>;
}

export default async function OAuthCompletePage({ params }: OAuthCompletePageProps) {
  const { provider } = await params;
  const t = await getTranslations('auth.oauthComplete');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      </div>
      <OAuthCompleteController provider={provider} />
    </div>
  );
}
