'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
import { CreateWebhookDialog } from './CreateWebhookDialog';
import { RevealSecretDialog } from './RevealSecretDialog';
import type { WebhookSummary } from './http';
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useUpdateWebhook,
  useWebhooks,
} from './hooks/useWebhooks';

interface Props {
  workspaceSlug: string;
  canManage: boolean;
}

export function WebhooksView({ workspaceSlug, canManage }: Props) {
  const t = useTranslations('platform.webhooks');
  const [createOpen, setCreateOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<{ raw: string; url: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookSummary | null>(null);
  const [rotateTarget, setRotateTarget] = useState<WebhookSummary | null>(null);

  const query = useWebhooks(workspaceSlug);
  const update = useUpdateWebhook(workspaceSlug);
  const remove = useDeleteWebhook(workspaceSlug);
  const rotate = useRotateWebhookSecret(workspaceSlug);

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
                  {t('table.url')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.events')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.status')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('table.created')}
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
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-4 py-3 font-mono text-xs">{row.url}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.eventTypes.map((event) => (
                        <Badge key={event} variant="secondary" className="font-mono text-[10px]">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={row.isActive ? 'default' : 'secondary'}>
                      {row.isActive ? t('status.active') : t('status.inactive')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
                  {canManage ? (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            update
                              .mutateAsync({ id: row.id, input: { isActive: !row.isActive } })
                              .then(() => toast.success(t('toast.updated')))
                              .catch(() => toast.error(t('toast.updateFailed')))
                          }
                        >
                          {row.isActive ? t('actions.disable') : t('actions.enable')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setRotateTarget(row)}>
                          {t('actions.rotate')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(row)}
                          aria-label={`${t('actions.delete')}: ${row.url}`}
                        >
                          {t('actions.delete')}
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceSlug={workspaceSlug}
        onCreated={(created) => {
          setCreateOpen(false);
          setRevealSecret({ raw: created.rawSecret, url: created.webhook.url });
          toast.success(t('toast.created'));
        }}
      />

      <RevealSecretDialog
        open={revealSecret !== null}
        onOpenChange={(next) => {
          if (!next) setRevealSecret(null);
        }}
        rawSecret={revealSecret?.raw ?? ''}
        url={revealSecret?.url ?? ''}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await remove.mutateAsync(deleteTarget.id);
                  toast.success(t('toast.deleted'));
                } catch {
                  toast.error(t('toast.deleteFailed'));
                } finally {
                  setDeleteTarget(null);
                }
              }}
            >
              {t('delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rotateTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRotateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rotate.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('rotate.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('rotate.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!rotateTarget) return;
                try {
                  const result = await rotate.mutateAsync(rotateTarget.id);
                  setRevealSecret({ raw: result.rawSecret, url: result.webhook.url });
                  toast.success(t('toast.rotated'));
                } catch {
                  toast.error(t('toast.rotateFailed'));
                } finally {
                  setRotateTarget(null);
                }
              }}
            >
              {t('rotate.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
