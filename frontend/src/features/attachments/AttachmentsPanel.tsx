'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Paperclip, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HttpError } from '@/lib/http/errors';
import { attachmentsHttp } from '@/lib/http/attachments';
import type { WorkspaceRole } from '@/lib/http/types';
import { useAttachments } from './useAttachments';
import { useAttachmentUpload, type UploadItem } from './useAttachmentUpload';
import { useDeleteAttachment } from './useDeleteAttachment';

interface AttachmentsPanelProps {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
}

function canDelete(role: WorkspaceRole, isUploader: boolean): boolean {
  if (role === 'OWNER' || role === 'ADMIN') return true;
  return isUploader;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drag-and-drop panel for task attachments. Wires the file picker + drop
 * zone to `useAttachmentUpload` (sign → PUT → confirm), lists READY rows,
 * and offers per-row download + delete. Uploader OR workspace Admin/Owner
 * can delete — enforced client-side for the UX and by the API for safety.
 */
export function AttachmentsPanel({
  workspaceSlug,
  projectSlug,
  taskNumber,
  currentUserId,
  currentUserRole,
}: AttachmentsPanelProps) {
  const t = useTranslations('board.attachments');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { data, isLoading } = useAttachments({ workspaceSlug, projectSlug, taskNumber });
  const upload = useAttachmentUpload({ workspaceSlug, projectSlug, taskNumber });
  const del = useDeleteAttachment({ workspaceSlug, projectSlug, taskNumber });

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      upload.start(list);
    },
    [upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  async function download(attachmentId: string) {
    try {
      const { url } = await attachmentsHttp.download(
        workspaceSlug,
        projectSlug,
        taskNumber,
        attachmentId,
      );
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title);
      else toast.error(t('errors.uploadFailed'));
    }
  }

  const items = data?.items ?? [];

  return (
    <section className="flex flex-col gap-3" aria-label={t('label')}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('heading')} <span className="ml-1 text-muted-foreground">({items.length})</span>
        </h4>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = '';
            }}
            aria-label={t('add')}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
            <Paperclip className="h-3 w-3" aria-hidden="true" />
            {t('add')}
          </Button>
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-md border border-dashed p-3 text-xs transition-colors',
          isDragging
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border text-muted-foreground',
        )}
        role="region"
      >
        {t('drop')}
      </div>

      {upload.items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {upload.items.map((item) => (
            <UploadRow
              key={item.clientId}
              item={item}
              onCancel={() => upload.cancel(item.clientId)}
            />
          ))}
        </ul>
      ) : null}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((attachment) => {
            const removable = canDelete(
              currentUserRole,
              attachment.uploaderUserId === currentUserId,
            );
            return (
              <li
                key={attachment.id}
                className="flex items-center justify-between rounded-md border border-border bg-background p-2 text-sm"
              >
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate font-medium">{attachment.filename}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatBytes(attachment.sizeBytes)} · {attachment.mime}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => void download(attachment.id)}
                    aria-label={t('download')}
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                  </Button>
                  {removable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-destructive"
                      onClick={() => del.mutate({ attachmentId: attachment.id })}
                      aria-label={t('delete')}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: () => void }) {
  const t = useTranslations('board.attachments');
  const pct = item.total > 0 ? Math.min(100, Math.round((item.loaded / item.total) * 100)) : 0;
  const isTerminal =
    item.status === 'ready' || item.status === 'failed' || item.status === 'canceled';
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-dashed border-border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium" title={item.file.name}>
          {item.file.name}
        </span>
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
          {!isTerminal ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px]"
              onClick={onCancel}
              aria-label={t('cancel')}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            item.status === 'failed' ? 'bg-destructive' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {item.status === 'failed' && item.errorKey ? (
        <span className="text-destructive">{t(`errors.${item.errorKey}`)}</span>
      ) : null}
      {item.status === 'canceled' ? (
        <span className="text-muted-foreground">{t('cancel')}</span>
      ) : null}
    </li>
  );
}
