import { browserHttp } from './browser';
import type { Attachment, CursorPage, SignedUpload } from './types';

export interface SignAttachmentInput {
  filename: string;
  mime: string;
  sizeBytes: number;
}

function base(workspaceSlug: string, projectSlug: string, taskNumber: number): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/attachments`;
}

export const attachmentsHttp = {
  list(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    opts: { cursor?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (opts.cursor) query.set('cursor', opts.cursor);
    if (typeof opts.limit === 'number') query.set('limit', String(opts.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return browserHttp.get<CursorPage<Attachment>>(
      `${base(workspaceSlug, projectSlug, taskNumber)}${suffix}`,
    );
  },
  sign(workspaceSlug: string, projectSlug: string, taskNumber: number, input: SignAttachmentInput) {
    return browserHttp.post<SignedUpload>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/sign`,
      input,
    );
  },
  confirm(workspaceSlug: string, projectSlug: string, taskNumber: number, attachmentId: string) {
    return browserHttp.post<Attachment>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/${attachmentId}/confirm`,
    );
  },
  download(workspaceSlug: string, projectSlug: string, taskNumber: number, attachmentId: string) {
    return browserHttp.get<{ url: string }>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/${attachmentId}/download`,
    );
  },
  remove(workspaceSlug: string, projectSlug: string, taskNumber: number, attachmentId: string) {
    return browserHttp.delete<void>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/${attachmentId}`,
    );
  },
};

/**
 * Uploads a file to object storage using the signed PUT url returned by the
 * `sign` endpoint. Bytes never traverse the API tier — this fires straight at
 * S3/MinIO. Reports progress via `XMLHttpRequest.upload.onprogress` and honors
 * an AbortSignal so the drawer's "cancel" affordance really cancels the PUT.
 */
export function putSignedUpload(input: {
  uploadUrl: string;
  file: File;
  onProgress?: (bytesLoaded: number, bytesTotal: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.uploadUrl, true);
    xhr.setRequestHeader('Content-Type', input.file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed: network error'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

    if (input.signal) {
      if (input.signal.aborted) {
        xhr.abort();
        return;
      }
      input.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(input.file);
  });
}
