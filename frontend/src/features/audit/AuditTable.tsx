'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { auditHttp, type AuditRow } from '@/lib/http/audit';
import { useAuditQuery } from './useAuditQuery';
import { AuditRowDrawer } from './AuditRowDrawer';
import { AuditFilters } from './AuditFilters';
import type { AuditParams } from './auditParams';

interface AuditTableProps {
  workspaceSlug: string;
  params: AuditParams;
}

export function AuditTable({ workspaceSlug, params }: AuditTableProps) {
  const t = useTranslations('audit.table');
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const query = useAuditQuery({ workspaceSlug, params });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const csvHref = auditHttp.csvExportUrl(workspaceSlug, params);

  return (
    <div className="flex flex-col gap-4">
      <AuditFilters workspaceSlug={workspaceSlug} params={params} csvHref={csvHref} />

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('when')}</TableHead>
              <TableHead>{t('actor')}</TableHead>
              <TableHead>{t('action')}</TableHead>
              <TableHead>{t('target')}</TableHead>
              <TableHead className="w-16 text-right">{t('detail')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`skel-${i}`}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{row.actor?.displayName ?? t('system')}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.event}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.targetType ? (
                      <span className="text-sm">
                        {row.targetType}
                        {row.targetId ? (
                          <span className="text-muted-foreground"> · {row.targetId}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
                      {t('open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}

      <AuditRowDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
