'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { IntegrationProviderName } from '@tasker/config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { IntegrationSummary } from './http';
import {
  useDisconnectIntegration,
  useIntegrations,
  useStartGithubConnection,
} from './hooks/useIntegrations';

interface Props {
  workspaceSlug: string;
  canManage: boolean;
}

interface ProviderCard {
  provider: IntegrationProviderName;
  labelKey: 'github.label' | 'google.label';
  descriptionKey: 'github.description' | 'google.description';
  disabled?: boolean;
}

const PROVIDERS: readonly ProviderCard[] = [
  { provider: 'GITHUB', labelKey: 'github.label', descriptionKey: 'github.description' },
  {
    provider: 'GOOGLE_CALENDAR',
    labelKey: 'google.label',
    descriptionKey: 'google.description',
    disabled: true,
  },
];

export function IntegrationsView({ workspaceSlug, canManage }: Props) {
  const t = useTranslations('platform.integrations');
  const query = useIntegrations(workspaceSlug);
  const disconnect = useDisconnectIntegration(workspaceSlug);
  const startGithub = useStartGithubConnection(workspaceSlug);

  const byProvider = new Map<IntegrationProviderName, IntegrationSummary>();
  for (const item of query.data?.items ?? []) {
    byProvider.set(item.provider, item);
  }

  async function handleConnectGithub() {
    try {
      const result = await startGithub.mutateAsync(undefined);
      // Redirect the browser to GitHub's authorize URL. On success GitHub
      // will redirect back to our OAUTH_CALLBACK_BASE_URL, which the API
      // side finishes with a `complete` call.
      window.location.href = result.authorizeUrl;
    } catch {
      toast.error(t('toast.startFailed'));
    }
  }

  async function handleDisconnect(provider: IntegrationProviderName) {
    try {
      await disconnect.mutateAsync(provider);
      toast.success(t('toast.disconnected'));
    } catch {
      toast.error(t('toast.disconnectFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {!query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((card) => {
            const existing = byProvider.get(card.provider);
            return (
              <article
                key={card.provider}
                className="flex flex-col gap-3 rounded-md border border-border/60 p-4"
              >
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{t(card.labelKey)}</h2>
                    <p className="text-xs text-muted-foreground">{t(card.descriptionKey)}</p>
                  </div>
                  {existing ? (
                    <Badge variant={existing.state === 'CONNECTED' ? 'default' : 'secondary'}>
                      {t(`state.${existing.state}` as 'state.CONNECTED')}
                    </Badge>
                  ) : null}
                </header>
                <footer className="flex justify-end">
                  {existing ? (
                    canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnect(card.provider)}
                      >
                        {t('actions.disconnect')}
                      </Button>
                    ) : null
                  ) : (
                    <Button
                      size="sm"
                      onClick={card.provider === 'GITHUB' ? handleConnectGithub : undefined}
                      disabled={
                        !canManage ||
                        card.disabled ||
                        (card.provider === 'GITHUB' && startGithub.isPending)
                      }
                    >
                      {card.disabled ? t('actions.comingSoon') : t('actions.connect')}
                    </Button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
