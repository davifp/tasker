import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Raw secret entropy — 32 bytes = 256 bits, base64url-encoded (~43 chars).
const SECRET_ENTROPY_BYTES = 32;
// AES-256-GCM: 12-byte nonce is the standard choice for stream mode.
const NONCE_BYTES = 12;
// AES-256-GCM authentication tag is always 16 bytes.
const AUTH_TAG_BYTES = 16;

/** Stripe-style compact signature header: `t=<unix>,v1=<hex-hmac>`. */
export interface SignatureHeader {
  timestamp: number;
  v1: string;
}

export interface GeneratedWebhookSecret {
  /** The plain-text secret returned to the caller exactly once. */
  raw: string;
  /**
   * Persisted in the `secretSalt` column — actually the AES-GCM nonce for
   * decrypting the ciphertext below. The column name is retained for schema
   * compatibility with the original hash-based design.
   */
  salt: string;
  /**
   * Persisted in the `secretHash` column — actually the AES-256-GCM
   * ciphertext of the raw secret with the auth tag appended (all hex-encoded).
   */
  hash: string;
}

/**
 * Pure signer for outbound webhook deliveries. Mirrors Stripe's scheme so
 * receivers can copy any Stripe-verified sample by swapping the header name.
 *
 * Signature payload: `${timestamp}.${rawJsonBody}`; HMAC-SHA256 with the
 * subscription secret; hex-encoded. The receiver rebuilds the same string and
 * `timingSafeEqual`s against the header value.
 */
export class WebhookSigner {
  private readonly key: Buffer;

  /**
   * `masterKey` is any high-entropy string (the app passes `JWT_SECRET`, which
   * is required to be ≥ 32 chars) — we SHA-256 it once at construction to
   * land on a 32-byte AES key.
   */
  constructor(masterKey: string) {
    this.key = createHash('sha256').update(masterKey).digest();
  }

  generateSecret(): GeneratedWebhookSecret {
    const raw = randomBytes(SECRET_ENTROPY_BYTES).toString('base64url');
    return this.encrypt(raw);
  }

  encrypt(raw: string): GeneratedWebhookSecret {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const enc = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      raw,
      salt: nonce.toString('hex'),
      hash: Buffer.concat([enc, authTag]).toString('hex'),
    };
  }

  /**
   * Decrypt a stored secret back to its raw form so the delivery processor
   * can sign each outbound request. Throws if the ciphertext was tampered
   * with — the auth tag check in AES-GCM covers integrity.
   */
  decrypt(salt: string, hash: string): string {
    const nonce = Buffer.from(salt, 'hex');
    const combined = Buffer.from(hash, 'hex');
    if (combined.length <= AUTH_TAG_BYTES) {
      throw new Error('Ciphertext too short — likely stored under a stale format');
    }
    const enc = combined.subarray(0, combined.length - AUTH_TAG_BYTES);
    const authTag = combined.subarray(combined.length - AUTH_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  /**
   * Build the outbound `Tasker-Signature` header. `rawBody` MUST be the exact
   * byte string that goes on the wire — re-serialising after signing changes
   * whitespace/ordering and breaks receiver verification.
   */
  sign(rawBody: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
    const v1 = this.computeV1(timestamp, rawBody, secret);
    return `t=${timestamp},v1=${v1}`;
  }

  private computeV1(timestamp: number, rawBody: string, secret: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  /** Parse a header emitted by `sign` — returns null on malformed input. */
  parseHeader(header: string): SignatureHeader | null {
    const parts = header.split(',').map((p) => p.trim());
    let timestamp: number | undefined;
    let v1: string | undefined;
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = part.slice(0, eqIdx);
      const value = part.slice(eqIdx + 1);
      if (key === 't') {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) timestamp = n;
      } else if (key === 'v1') {
        v1 = value;
      }
    }
    if (timestamp === undefined || !v1) return null;
    return { timestamp, v1 };
  }

  /**
   * Receiver-side verification. Exposed as a helper so tests can round-trip
   * the exact bytes we send. Rejects clock skew beyond `toleranceSeconds`.
   */
  verifySignature(
    rawBody: string,
    secret: string,
    header: string,
    now: number = Math.floor(Date.now() / 1000),
    toleranceSeconds = 300,
  ): boolean {
    const parsed = this.parseHeader(header);
    if (!parsed) return false;
    if (Math.abs(now - parsed.timestamp) > toleranceSeconds) return false;
    const expected = Buffer.from(this.computeV1(parsed.timestamp, rawBody, secret), 'hex');
    const actual = Buffer.from(parsed.v1, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
