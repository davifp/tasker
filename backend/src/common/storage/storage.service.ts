/**
 * Port for the object-storage layer. Kept intentionally narrow: the API
 * signs URLs and issues DELETEs — bytes never traverse the API tier
 * (see PRD FR-17 / techspec § Integration points › Object storage).
 *
 * Exposed as an abstract class so NestJS DI can use it as an injection token
 * without a separate string/symbol constant. Concrete implementations
 * (S3StorageAdapter) declare themselves via `{ provide: StorageService,
 * useClass: S3StorageAdapter }` in `StorageModule`.
 */

export interface SignPutInput {
  key: string;
  mime: string;
  sizeBytes: number;
  expiresInSec?: number;
}

export interface SignedPut {
  url: string;
  key: string;
  expiresAt: Date;
}

export interface SignGetOptions {
  expiresInSec?: number;
}

export abstract class StorageService {
  abstract signPutUrl(input: SignPutInput): Promise<SignedPut>;
  abstract signGetUrl(key: string, opts?: SignGetOptions): Promise<string>;
  abstract scheduleDelete(key: string): Promise<void>;
  /**
   * Lightweight liveness check. Throws when the backing bucket cannot be
   * reached, is missing, or credentials are rejected — used by
   * `StorageHealthIndicator` to fail /readiness fast. Implementations MUST
   * honor `timeoutMs` via an `AbortSignal`.
   */
  abstract checkAvailability(timeoutMs: number): Promise<void>;
}
