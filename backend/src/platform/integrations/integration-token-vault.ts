import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface SealedToken {
  /** hex-encoded AES-GCM ciphertext with the 16-byte auth tag appended. */
  ciphertext: string;
  /** hex-encoded 12-byte nonce. */
  nonce: string;
}

/**
 * Symmetric vault for OAuth access + refresh tokens stored in
 * `Integration.config`. Same construction as `WebhookSigner`: derive a 32-byte
 * AES key from the app master secret so no new KMS dependency is added.
 */
export class IntegrationTokenVault {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    this.key = createHash('sha256').update(masterKey).digest();
  }

  seal(plaintext: string): SealedToken {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([enc, authTag]).toString('hex'),
      nonce: nonce.toString('hex'),
    };
  }

  open(sealed: SealedToken): string {
    const nonce = Buffer.from(sealed.nonce, 'hex');
    const combined = Buffer.from(sealed.ciphertext, 'hex');
    if (combined.length <= AUTH_TAG_BYTES) {
      throw new Error('Ciphertext too short — likely stored under a stale format');
    }
    const enc = combined.subarray(0, combined.length - AUTH_TAG_BYTES);
    const authTag = combined.subarray(combined.length - AUTH_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
