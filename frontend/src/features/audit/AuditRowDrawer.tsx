'use client';

import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import type { AuditRow } from '@/lib/http/audit';

interface AuditRowDrawerProps {
  row: AuditRow | null;
  onClose: () => void;
}

export function AuditRowDrawer({ row, onClose }: AuditRowDrawerProps) {
  const t = useTranslations('audit.drawer');
  const open = row !== null;
  return (
    <Sheet open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <SheetContent className="w-[520px] max-w-full">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        {row ? (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <Field label={t('field.event')} value={row.event} />
            <Field label={t('field.actor')} value={row.actor?.displayName ?? t('systemActor')} />
            <Field label={t('field.when')} value={new Date(row.createdAt).toLocaleString()} />
            <Field label={t('field.targetType')} value={row.targetType ?? '—'} />
            <Field label={t('field.targetId')} value={row.targetId ?? '—'} />
            <Field label={t('field.traceId')} value={row.traceId ?? '—'} />
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                {t('field.metadata')}
              </div>
              <Badge variant="outline">{t('readOnly')}</Badge>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="break-all">{value}</div>
    </div>
  );
}
