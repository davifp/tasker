import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '@tasker/config';
import { SignGetOptions, SignPutInput, SignedPut, StorageService } from './storage.service';

/**
 * S3-compatible adapter. One code path spans AWS S3, Cloudflare R2, and MinIO;
 * the difference is entirely in env (endpoint, region, credentials,
 * forcePathStyle). See techspec § Integration points › Object storage and
 * § Known risks › MinIO parity drift.
 */
@Injectable()
export class S3StorageAdapter extends StorageService {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultPutTtlSec: number;
  private readonly defaultGetTtlSec: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.defaultPutTtlSec = config.get('STORAGE_PUT_URL_TTL_S', { infer: true });
    this.defaultGetTtlSec = config.get('STORAGE_GET_URL_TTL_S', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
      region: config.get('STORAGE_REGION', { infer: true }),
      forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  async signPutUrl(input: SignPutInput): Promise<SignedPut> {
    const expiresInSec = input.expiresInSec ?? this.defaultPutTtlSec;
    // ContentType is included in the signed request; browsers PUTting the
    // bytes must send the same Content-Type or S3 will reject the signature.
    // ContentLength is signed the same way; keeping the client-declared
    // size honest cuts off oversize workarounds after signing.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.mime,
      ContentLength: input.sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSec,
      // Force these headers into the signature so the browser cannot swap
      // them mid-flight (defense in depth on top of the DTO gate).
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      key: input.key,
      expiresAt: new Date(Date.now() + expiresInSec * 1000),
    };
  }

  async signGetUrl(key: string, opts: SignGetOptions = {}): Promise<string> {
    const expiresInSec = opts.expiresInSec ?? this.defaultGetTtlSec;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
  }

  async checkAvailability(timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async scheduleDelete(key: string): Promise<void> {
    // MVP: fire the DELETE now. The interface says "schedule" so callers can
    // move to a BullMQ job later without changing the port. Failures are
    // logged but do not throw — the DB row is already marked DELETING and
    // will be swept by the janitor.
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      this.logger.warn({ err, storageKey: key }, 'Storage DELETE failed; the janitor will retry');
    }
  }
}
