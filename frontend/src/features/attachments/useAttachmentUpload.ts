import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ATTACHMENT_MAX_BYTES, isAllowedAttachmentMime } from '@tasker/config';
import { attachmentsHttp, putSignedUpload } from '@/lib/http/attachments';
import { taskKeys } from '@/features/queryKeys';
import type { Attachment, CursorPage } from '@/lib/http/types';

export type UploadStatus = 'pending' | 'uploading' | 'ready' | 'failed' | 'canceled';

export interface UploadItem {
  clientId: string;
  file: File;
  status: UploadStatus;
  loaded: number;
  total: number;
  errorKey?: 'tooLarge' | 'mimeBlocked' | 'uploadFailed';
  attachmentId?: string;
}

interface UseAttachmentUploadArgs {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

/**
 * Manages a small in-memory list of in-flight uploads and drives each through
 * the sign → PUT → confirm sequence. Bytes stream direct to storage via
 * `putSignedUpload`; the API only signs and confirms.
 *
 * Client-side gates (size + mime) mirror the backend `signAttachmentSchema`
 * so a rejection surfaces immediately without a round trip. The server still
 * enforces the same rules — this is a UX shortcut, not the authoritative
 * check.
 */
export function useAttachmentUpload({
  workspaceSlug,
  projectSlug,
  taskNumber,
}: UseAttachmentUploadArgs) {
  const queryClient = useQueryClient();
  const key = taskKeys.attachments(workspaceSlug, projectSlug, taskNumber);
  const [items, setItems] = useState<UploadItem[]>([]);
  // AbortControllers keyed by clientId so cancel() only aborts the target.
  const controllers = useRef<Map<string, AbortController>>(new Map());

  const patch = useCallback((clientId: string, next: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.clientId === clientId ? { ...item, ...next } : item)),
    );
  }, []);

  const runUpload = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.clientId, controller);
      try {
        const signed = await attachmentsHttp.sign(workspaceSlug, projectSlug, taskNumber, {
          filename: item.file.name,
          mime: item.file.type || 'application/octet-stream',
          sizeBytes: item.file.size,
        });
        patch(item.clientId, { status: 'uploading', attachmentId: signed.attachmentId });

        await putSignedUpload({
          uploadUrl: signed.uploadUrl,
          file: item.file,
          onProgress: (loaded, total) => patch(item.clientId, { loaded, total }),
          signal: controller.signal,
        });

        const confirmed = await attachmentsHttp.confirm(
          workspaceSlug,
          projectSlug,
          taskNumber,
          signed.attachmentId,
        );

        // Prepend the confirmed row to the cache so the panel shows it
        // without waiting for the next fetch tick.
        queryClient.setQueryData<CursorPage<Attachment>>(key, (prev) =>
          prev
            ? { ...prev, items: [confirmed, ...prev.items] }
            : { items: [confirmed], nextCursor: null },
        );
        void queryClient.invalidateQueries({ queryKey: key });

        patch(item.clientId, { status: 'ready', loaded: item.file.size, total: item.file.size });
      } catch (err) {
        const canceled = err instanceof DOMException && err.name === 'AbortError';
        patch(item.clientId, {
          status: canceled ? 'canceled' : 'failed',
          errorKey: canceled ? undefined : 'uploadFailed',
        });
      } finally {
        controllers.current.delete(item.clientId);
      }
    },
    [queryClient, key, workspaceSlug, projectSlug, taskNumber, patch],
  );

  const start = useCallback(
    (files: File[]) => {
      const fresh: UploadItem[] = files.map((file) => {
        const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (file.size > ATTACHMENT_MAX_BYTES) {
          return {
            clientId,
            file,
            status: 'failed',
            loaded: 0,
            total: file.size,
            errorKey: 'tooLarge',
          };
        }
        if (!isAllowedAttachmentMime(file.type || 'application/octet-stream')) {
          return {
            clientId,
            file,
            status: 'failed',
            loaded: 0,
            total: file.size,
            errorKey: 'mimeBlocked',
          };
        }
        return { clientId, file, status: 'pending', loaded: 0, total: file.size };
      });
      setItems((prev) => [...prev, ...fresh]);
      for (const item of fresh) {
        if (item.status === 'pending') void runUpload(item);
      }
    },
    [runUpload],
  );

  const cancel = useCallback((clientId: string) => {
    controllers.current.get(clientId)?.abort();
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) =>
      prev.filter((item) => item.status === 'uploading' || item.status === 'pending'),
    );
  }, []);

  return { items, start, cancel, clearFinished };
}
