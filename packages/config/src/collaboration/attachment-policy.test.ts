import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_ALLOWLIST,
  ATTACHMENT_POLICY_SUMMARY,
  ATTACHMENT_UPLOAD_URL_TTL_SEC,
  ATTACHMENT_DOWNLOAD_URL_TTL_SEC,
  isAllowedAttachmentMime,
} from './attachment-policy';

describe('ATTACHMENT_MAX_BYTES', () => {
  it('caps at 25 MiB (per PRD FR-16)', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('URL TTLs', () => {
  it('signs upload URLs for 60 s and downloads for 5 min (per techspec)', () => {
    expect(ATTACHMENT_UPLOAD_URL_TTL_SEC).toBe(60);
    expect(ATTACHMENT_DOWNLOAD_URL_TTL_SEC).toBe(300);
  });
});

describe('isAllowedAttachmentMime', () => {
  it.each(ATTACHMENT_MIME_ALLOWLIST.images)('accepts image mime %s', (mime) => {
    expect(isAllowedAttachmentMime(mime)).toBe(true);
  });

  it.each(ATTACHMENT_MIME_ALLOWLIST.documents)('accepts document mime %s', (mime) => {
    expect(isAllowedAttachmentMime(mime)).toBe(true);
  });

  it.each(ATTACHMENT_MIME_ALLOWLIST.archives)('accepts archive mime %s', (mime) => {
    expect(isAllowedAttachmentMime(mime)).toBe(true);
  });

  it('rejects executable mimes', () => {
    expect(isAllowedAttachmentMime('application/x-msdownload')).toBe(false);
    expect(isAllowedAttachmentMime('application/x-sh')).toBe(false);
  });

  it('rejects video mimes not in the allowlist', () => {
    expect(isAllowedAttachmentMime('video/mp4')).toBe(false);
  });
});

describe('ATTACHMENT_POLICY_SUMMARY', () => {
  it('is frozen so clients cannot mutate it', () => {
    expect(Object.isFrozen(ATTACHMENT_POLICY_SUMMARY)).toBe(true);
    expect(Object.isFrozen(ATTACHMENT_POLICY_SUMMARY.mimes)).toBe(true);
  });

  it('mirrors the cap and set flatly', () => {
    expect(ATTACHMENT_POLICY_SUMMARY.maxBytes).toBe(ATTACHMENT_MAX_BYTES);
    expect(ATTACHMENT_POLICY_SUMMARY.mimes).toContain('image/png');
    expect(ATTACHMENT_POLICY_SUMMARY.mimes).toContain('application/pdf');
    expect(ATTACHMENT_POLICY_SUMMARY.mimes).toContain('application/zip');
  });
});
