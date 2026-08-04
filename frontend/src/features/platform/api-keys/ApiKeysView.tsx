'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { API_KEY_SCOPES, type ApiKeyScope } from '@tasker/config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';
import { RevealKeyDialog } from './RevealKeyDialog';
import type { ApiKeySummary } from './http';
import { useApiKeys, useRevokeApiKey } from './hooks/useApiKeys';

interface Props {
  workspaceSlug: string;
  canManage: boolean;
}

export function ApiKeysView({ workspaceSlug, canManage }: Props) {
  const t = useTranslations('platform.apiKeys');
  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<{ raw: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);

  const query = useApiKeys(workspaceSlug, { includeRevoked: true });
  const revoke = useRevokeApiKey(workspaceSlug);

  const rows = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)}>{t('createButton')}</Button>
        ) : null}
      </div>

      {query.isLoading ? <TableSkeleton /> : null}

      {!query.isLoading && rows.length === 0 ? (
        <div className="rounded-md border border-border/60 p-6 text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : null}

      {!query.isLoading && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">
                  {t('table.name')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.prefix')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.scopes')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.created')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.lastUsed')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.expires')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.status')}
                </th>
                {canManage ? (
                  <th scope="col" className="px-4 py-3 text-right">
                    {t('table.actions')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ApiKeyRow
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  onRevoke={() => setRevokeTarget(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceSlug={workspaceSlug}
        onCreated={(created) => {
          setCreateOpen(false);
          setRevealKey({ raw: created.rawKey, name: created.key.name });
          toast.success(t('toast.created'));
        }}
      />

      <RevealKeyDialog
        open={revealKey !== null}
        onOpenChange={(next) => {
          if (!next) setRevealKey(null);
        }}
        rawKey={revealKey?.raw ?? ''}
        name={revealKey?.name ?? ''}
      />

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revoke.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('revoke.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('revoke.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!revokeTarget) return;
                try {
                  await revoke.mutateAsync(revokeTarget.id);
                  toast.success(t('toast.revoked'));
                } catch {
                  toast.error(t('toast.revokeFailed'));
                } finally {
                  setRevokeTarget(null);
                }
              }}
            >
              {t('revoke.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ApiKeyRowProps {
  row: ApiKeySummary;
  canManage: boolean;
  onRevoke: () => void;
}

function ApiKeyRow({ row, canManage, onRevoke }: ApiKeyRowProps) {
  const t = useTranslations('platform.apiKeys');
  const status = useMemo<'active' | 'revoked' | 'expired'>(() => {
    if (row.revokedAt) return 'revoked';
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }, [row.revokedAt, row.expiresAt]);

  return (
    <tr className="border-t border-border/60">
      <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {row.keyPrefix}_…{row.last4}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <ScopeBadge key={scope} scope={scope} />
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {row.lastUsedAt ? formatDate(row.lastUsedAt) : t('value.never')}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {row.expiresAt ? formatDate(row.expiresAt) : t('value.noExpiration')}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={status} />
      </td>
      {canManage ? (
        <td className="px-4 py-3 text-right">
          {status === 'active' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRevoke}
              aria-label={`${t('revoke.action')}: ${row.name}`}
            >
              {t('revoke.action')}
            </Button>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

function ScopeBadge({ scope }: { scope: ApiKeyScope }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {scope}
    </Badge>
  );
}

function StatusBadge({ status }: { status: 'active' | 'revoked' | 'expired' }) {
  const t = useTranslations('platform.apiKeys.status');
  // Icon + label (not colour alone) so the state is accessible without CSS.
  const variantByStatus: Record<
    'active' | 'revoked' | 'expired',
    'default' | 'secondary' | 'destructive'
  > = {
    active: 'default',
    revoked: 'destructive',
    expired: 'secondary',
  };
  const iconByStatus: Record<'active' | 'revoked' | 'expired', string> = {
    active: '●',
    revoked: '⊘',
    expired: '⏱',
  };
  return (
    <Badge variant={variantByStatus[status]}>
      <span aria-hidden className="mr-1">
        {iconByStatus[status]}
      </span>
      {t(status)}
    </Badge>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Re-exported so imports elsewhere stay simple. Keeps the barrel small.
export { API_KEY_SCOPES };
