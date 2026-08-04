import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The raw key is a base64url string of RAW_ENTROPY_BYTES bytes; 32 bytes = 256
// bits of entropy is plenty for a bearer secret and stays under URL-safe caps.
const RAW_ENTROPY_BYTES = 32;
const SALT_BYTES = 16;

export interface GeneratedApiKey {
  /** The full string returned to the caller exactly once (e.g. `tsk_live_xxx…`). */
  raw: string;
  /** The prefix portion (`tsk_live`) — safe for display and secret-scanning. */
  prefix: string;
  /** Last 4 characters of the raw suffix — safe for display. */
  last4: string;
  /** Random salt used to derive the hash. Store alongside the hash. */
  salt: string;
  /** HMAC-SHA256 digest of the raw key using `salt` as the key. */
  hash: string;
}

/**
 * Pure helper: create, hash, and verify API keys. Kept side-effect free so it
 * can be unit-tested with golden vectors and reused by the auth guard.
 *
 * Format: `<prefix>_<base64url(32 random bytes)>`. Verification is a two-step
 * dance: look up the row by (prefix, last4) — a cheap indexed short-list —
 * then constant-time compare on the derived hash.
 */
export class ApiKeyHasher {
  /**
   * Mint a fresh key. `prefix` is env-controlled (`API_KEY_PREFIX`, default
   * `tsk_live`) so environments can pick their own for scanner regexes.
   */
  generate(prefix: string): GeneratedApiKey {
    const suffix = randomBytes(RAW_ENTROPY_BYTES).toString('base64url');
    const raw = `${prefix}_${suffix}`;
    const last4 = suffix.slice(-4);
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const hash = this.hash(raw, salt);
    return { raw, prefix, last4, salt, hash };
  }

  /** Derive the storage hash for a raw key. Deterministic given `raw + salt`. */
  hash(raw: string, salt: string): string {
    return createHmac('sha256', salt).update(raw).digest('hex');
  }

  /**
   * Constant-time verification. Both sides are known to be equal length (hex
   * digest of SHA-256 is always 64 characters), so `timingSafeEqual` never
   * throws on mismatched buffer sizes.
   */
  verify(raw: string, salt: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(raw, salt), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  }

  /**
   * Split a raw key into (prefix, last4) so the guard can look up the row by
   * the cheap indexed columns before the full hash compare. Returns null if
   * the token doesn't look like an API key at all (JWT will hit the other
   * strategy in that case).
   */
  parse(raw: string): { prefix: string; last4: string } | null {
    const underscoreIdx = raw.lastIndexOf('_');
    if (underscoreIdx <= 0 || underscoreIdx === raw.length - 1) {
      return null;
    }
    const prefix = raw.slice(0, underscoreIdx);
    const suffix = raw.slice(underscoreIdx + 1);
    if (suffix.length < 4) {
      return null;
    }
    return { prefix, last4: suffix.slice(-4) };
  }
}
