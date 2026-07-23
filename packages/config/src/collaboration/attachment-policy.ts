/**
 * Attachment upload policy shared by the backend (signing endpoint) and the
 * frontend (client-side pre-flight). Server-side validation is authoritative;
 * client-side gating only exists to fail fast before requesting a signed URL.
 */

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_UPLOAD_URL_TTL_SEC = 60;

export const ATTACHMENT_DOWNLOAD_URL_TTL_SEC = 300;

/**
 * Mime allowlist grouped by category — categories are informational only, the
 * flat set below is what gates uploads.
 */
export const ATTACHMENT_MIME_ALLOWLIST = {
  images: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  documents: [
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  archives: ['application/zip'],
} as const;

const FLAT_ALLOWLIST: ReadonlySet<string> = new Set([
  ...ATTACHMENT_MIME_ALLOWLIST.images,
  ...ATTACHMENT_MIME_ALLOWLIST.documents,
  ...ATTACHMENT_MIME_ALLOWLIST.archives,
]);

export function isAllowedAttachmentMime(mime: string): boolean {
  return FLAT_ALLOWLIST.has(mime);
}

/**
 * Compact snapshot exposed to the UI so client-side hints (accept="", helper
 * text) can stay in sync with the server allowlist.
 */
export const ATTACHMENT_POLICY_SUMMARY = Object.freeze({
  maxBytes: ATTACHMENT_MAX_BYTES,
  mimes: Object.freeze([...FLAT_ALLOWLIST]),
});
