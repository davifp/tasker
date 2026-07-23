import { describe, it, expect, beforeAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { S3StorageAdapter } from '../src/common/storage/s3-storage.adapter';

/**
 * Real round-trip against the MinIO container defined in
 * `infra/docker-compose.yml`. Runs when MinIO is reachable at
 * localhost:9000 — the integration tests suite assumes the container
 * is up (same convention as Postgres/Redis).
 */

const MINIO_ENDPOINT = process.env['STORAGE_ENDPOINT'] ?? 'http://localhost:9000';

const CONFIG: Env = {
  STORAGE_ENDPOINT: MINIO_ENDPOINT,
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'tasker-attachments',
  STORAGE_ACCESS_KEY_ID: 'minioadmin',
  STORAGE_SECRET_ACCESS_KEY: 'minioadmin',
  STORAGE_FORCE_PATH_STYLE: true,
  STORAGE_PUT_URL_TTL_S: 60,
  STORAGE_GET_URL_TTL_S: 300,
} as unknown as Env;

const configService = {
  get: <K extends keyof Env>(key: K) => CONFIG[key],
} as unknown as ConfigService<Env, true>;

async function isMinioReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MINIO_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('S3StorageAdapter (integration — real MinIO)', () => {
  let adapter: S3StorageAdapter;
  let minioReachable = false;

  beforeAll(async () => {
    minioReachable = await isMinioReachable();
    adapter = new S3StorageAdapter(configService);
  });

  it('round-trips PUT + GET + DELETE against MinIO', async () => {
    if (!minioReachable) return;

    const key = `attachments/integration/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const payload = 'hello from storage.integration.spec.ts';
    const mime = 'text/plain';
    const bytes = new TextEncoder().encode(payload).byteLength;

    // 1) Sign PUT, upload via HTTP.
    const signed = await adapter.signPutUrl({ key, mime, sizeBytes: bytes });
    expect(signed.key).toBe(key);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const putRes = await fetch(signed.url, {
      method: 'PUT',
      headers: {
        'content-type': mime,
        'content-length': String(bytes),
      },
      body: payload,
    });
    expect(putRes.status).toBeGreaterThanOrEqual(200);
    expect(putRes.status).toBeLessThan(300);

    // 2) Sign GET, download via HTTP, verify body.
    const getUrl = await adapter.signGetUrl(key);
    const getRes = await fetch(getUrl);
    expect(getRes.status).toBe(200);
    const body = await getRes.text();
    expect(body).toBe(payload);

    // 3) Delete, verify GET now 404s (or 403 depending on bucket policy).
    await adapter.scheduleDelete(key);
    const afterDelete = await fetch(getUrl);
    expect(afterDelete.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a PUT that violates the signed content-length', async () => {
    if (!minioReachable) return;

    const key = `attachments/integration/${Date.now()}-mismatch.txt`;
    const signed = await adapter.signPutUrl({ key, mime: 'text/plain', sizeBytes: 10 });
    // Send more bytes than the signature allows — MinIO rejects the request.
    const res = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'content-length': '200' },
      body: 'x'.repeat(200),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
