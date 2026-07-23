import { ConfigService } from '@nestjs/config';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '@tasker/config';
import { S3StorageAdapter } from './s3-storage.adapter';

const BASE_ENV: Partial<Env> = {
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'tasker-attachments',
  STORAGE_ACCESS_KEY_ID: 'minioadmin',
  STORAGE_SECRET_ACCESS_KEY: 'minioadmin',
  STORAGE_FORCE_PATH_STYLE: true,
  STORAGE_PUT_URL_TTL_S: 60,
  STORAGE_GET_URL_TTL_S: 300,
};

function makeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const env = { ...BASE_ENV, ...overrides } as Env;
  return {
    get: <K extends keyof Env>(key: K) => env[key],
  } as unknown as ConfigService<Env, true>;
}

describe('S3StorageAdapter', () => {
  let adapter: S3StorageAdapter;

  beforeEach(() => {
    adapter = new S3StorageAdapter(makeConfig());
  });

  describe('signPutUrl', () => {
    it('returns a URL containing bucket + key under the configured endpoint (forcePathStyle)', async () => {
      const signed = await adapter.signPutUrl({
        key: 'attachments/ws-1/2026/07/abc.png',
        mime: 'image/png',
        sizeBytes: 1024,
      });
      const url = new URL(signed.url);
      expect(url.origin).toBe('http://localhost:9000');
      expect(url.pathname).toBe('/tasker-attachments/attachments/ws-1/2026/07/abc.png');
      expect(signed.key).toBe('attachments/ws-1/2026/07/abc.png');
    });

    it('signs with the default TTL when none is passed', async () => {
      const signed = await adapter.signPutUrl({
        key: 'attachments/ws-1/2026/07/x.png',
        mime: 'image/png',
        sizeBytes: 1024,
      });
      const url = new URL(signed.url);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    });

    it('honours an explicit expiresInSec override', async () => {
      const signed = await adapter.signPutUrl({
        key: 'attachments/ws-1/2026/07/y.png',
        mime: 'image/png',
        sizeBytes: 1024,
        expiresInSec: 900,
      });
      const url = new URL(signed.url);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    });

    it('bakes content-type into the signed headers', async () => {
      const signed = await adapter.signPutUrl({
        key: 'attachments/ws-1/2026/07/z.pdf',
        mime: 'application/pdf',
        sizeBytes: 2048,
      });
      const url = new URL(signed.url);
      // The signed header list appears as X-Amz-SignedHeaders; content-type
      // must be there or the browser PUT is rejected by the signer.
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    });

    it('sets expiresAt approximately expiresInSec into the future', async () => {
      const before = Date.now();
      const signed = await adapter.signPutUrl({
        key: 'attachments/ws-1/2026/07/w.png',
        mime: 'image/png',
        sizeBytes: 1024,
        expiresInSec: 120,
      });
      const after = Date.now();
      const ttlMs = signed.expiresAt.getTime();
      expect(ttlMs).toBeGreaterThanOrEqual(before + 120_000);
      expect(ttlMs).toBeLessThanOrEqual(after + 120_000);
    });
  });

  describe('signGetUrl', () => {
    it('returns a GET URL under the configured endpoint', async () => {
      const url = await adapter.signGetUrl('attachments/ws-1/2026/07/a.pdf');
      const parsed = new URL(url);
      expect(parsed.origin).toBe('http://localhost:9000');
      expect(parsed.pathname).toBe('/tasker-attachments/attachments/ws-1/2026/07/a.pdf');
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    });

    it('honours an explicit expiresInSec override', async () => {
      const url = await adapter.signGetUrl('attachments/ws-1/2026/07/b.pdf', {
        expiresInSec: 30,
      });
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('30');
    });
  });

  describe('scheduleDelete', () => {
    it('sends a DeleteObjectCommand', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sendSpy = vi.spyOn((adapter as any).client, 'send').mockResolvedValue({} as never);
      await adapter.scheduleDelete('attachments/ws-1/2026/07/gone.png');
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = sendSpy.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
      expect(sent.input.Bucket).toBe('tasker-attachments');
      expect(sent.input.Key).toBe('attachments/ws-1/2026/07/gone.png');
    });

    it('swallows storage errors so the janitor can retry (does not throw)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn((adapter as any).client, 'send').mockRejectedValue(new Error('MinIO down'));
      await expect(
        adapter.scheduleDelete('attachments/ws-1/2026/07/orphan.png'),
      ).resolves.toBeUndefined();
    });
  });

  describe('MinIO parity', () => {
    it('emits path-style URLs when STORAGE_FORCE_PATH_STYLE=true', async () => {
      const pathStyle = new S3StorageAdapter(makeConfig({ STORAGE_FORCE_PATH_STYLE: true }));
      const signed = await pathStyle.signPutUrl({
        key: 'attachments/x.png',
        mime: 'image/png',
        sizeBytes: 1,
      });
      const url = new URL(signed.url);
      // Path-style: bucket appears in the path, not the hostname.
      expect(url.hostname).toBe('localhost');
      expect(url.pathname.startsWith('/tasker-attachments/')).toBe(true);
    });
  });
});
