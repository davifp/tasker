import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookSigner } from './webhook-signer';

const TEST_MASTER = 'a-32-byte-master-key-for-testing-only';

describe('WebhookSigner', () => {
  const signer = new WebhookSigner(TEST_MASTER);

  describe('generateSecret / decrypt', () => {
    it('round-trips the raw secret through encrypt→decrypt', () => {
      const secret = signer.generateSecret();
      expect(signer.decrypt(secret.salt, secret.hash)).toBe(secret.raw);
    });

    it('produces distinct nonce + ciphertext per call', () => {
      const a = signer.generateSecret();
      const b = signer.generateSecret();
      expect(a.raw).not.toBe(b.raw);
      expect(a.salt).not.toBe(b.salt);
      expect(a.hash).not.toBe(b.hash);
    });

    it('raw secret is a 32-byte base64url string', () => {
      const secret = signer.generateSecret();
      // 32 bytes base64url-encoded → 43 chars (no padding).
      expect(secret.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('rejects tampered ciphertext via the GCM auth tag', () => {
      const secret = signer.generateSecret();
      // Flip the first hex character of the ciphertext (still valid hex).
      const first = secret.hash[0]!;
      const tampered = (first === '0' ? '1' : '0') + secret.hash.slice(1);
      expect(() => signer.decrypt(secret.salt, tampered)).toThrow();
    });

    it('rejects the correct ciphertext with a wrong nonce', () => {
      const secret = signer.generateSecret();
      const other = signer.generateSecret();
      expect(() => signer.decrypt(other.salt, secret.hash)).toThrow();
    });
  });

  describe('sign', () => {
    it('produces a header with t=<unix> and v1=<hex>', () => {
      const header = signer.sign('{"a":1}', 'secret', 1_700_000_000);
      expect(header).toBe(
        `t=1700000000,v1=${createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex')}`,
      );
    });

    it('changes when the body changes (by a single character)', () => {
      const a = signer.sign('{"a":1}', 's', 1);
      const b = signer.sign('{"a":2}', 's', 1);
      expect(a).not.toBe(b);
    });

    it('changes when the secret changes', () => {
      const a = signer.sign('{"a":1}', 's', 1);
      const b = signer.sign('{"a":1}', 't', 1);
      expect(a).not.toBe(b);
    });

    it('changes when the timestamp changes', () => {
      const a = signer.sign('{"a":1}', 's', 1);
      const b = signer.sign('{"a":1}', 's', 2);
      expect(a).not.toBe(b);
    });
  });

  describe('parseHeader', () => {
    it('returns null on malformed headers', () => {
      expect(signer.parseHeader('nope')).toBeNull();
      expect(signer.parseHeader('t=abc,v1=xyz')).toBeNull();
      expect(signer.parseHeader('t=1')).toBeNull();
    });

    it('parses the compact "t=,v1=" form', () => {
      const parsed = signer.parseHeader('t=1700000000,v1=abcdef');
      expect(parsed).toEqual({ timestamp: 1_700_000_000, v1: 'abcdef' });
    });
  });

  describe('verifySignature (receiver side)', () => {
    it('accepts the exact header emitted by sign', () => {
      const raw = '{"payload":true}';
      const ts = 1_700_000_500;
      const header = signer.sign(raw, 'shared-secret', ts);
      expect(signer.verifySignature(raw, 'shared-secret', header, ts)).toBe(true);
    });

    it('rejects a payload byte change even at the same timestamp', () => {
      const ts = 1_700_000_500;
      const header = signer.sign('{"a":1}', 's', ts);
      expect(signer.verifySignature('{"a":2}', 's', header, ts)).toBe(false);
    });

    it('rejects when clock skew exceeds tolerance', () => {
      const ts = 1_700_000_000;
      const header = signer.sign('body', 's', ts);
      expect(signer.verifySignature('body', 's', header, ts + 400)).toBe(false);
    });
  });
});
