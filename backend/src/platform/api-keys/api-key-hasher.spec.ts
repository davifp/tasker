import { describe, expect, it } from 'vitest';
import { ApiKeyHasher } from './api-key-hasher';

describe('ApiKeyHasher', () => {
  const hasher = new ApiKeyHasher();

  describe('generate', () => {
    it('produces a raw key that starts with the given prefix', () => {
      const key = hasher.generate('tsk_live');
      expect(key.raw.startsWith('tsk_live_')).toBe(true);
      expect(key.prefix).toBe('tsk_live');
    });

    it('exposes last4 as the last 4 chars of the suffix', () => {
      const key = hasher.generate('tsk_live');
      const suffix = key.raw.slice('tsk_live_'.length);
      expect(key.last4).toBe(suffix.slice(-4));
    });

    it('emits a new random raw + salt on every call', () => {
      const first = hasher.generate('tsk_live');
      const second = hasher.generate('tsk_live');
      expect(first.raw).not.toBe(second.raw);
      expect(first.salt).not.toBe(second.salt);
    });

    it('honours arbitrary prefixes without embedding underscores', () => {
      const key = hasher.generate('tsk_test');
      expect(key.raw.startsWith('tsk_test_')).toBe(true);
      expect(key.prefix).toBe('tsk_test');
    });
  });

  describe('hash', () => {
    it('is deterministic given the same (raw, salt) pair', () => {
      const salt = 'a1b2c3d4';
      const raw = 'tsk_live_abcdef';
      expect(hasher.hash(raw, salt)).toBe(hasher.hash(raw, salt));
    });

    it('is a 64-char hex string (SHA-256)', () => {
      const digest = hasher.hash('tsk_live_abcdef', 'salt-x');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when the salt changes', () => {
      const raw = 'tsk_live_abc';
      expect(hasher.hash(raw, 'salt-a')).not.toBe(hasher.hash(raw, 'salt-b'));
    });

    it('changes when the raw value changes', () => {
      const salt = 'salt';
      expect(hasher.hash('tsk_live_a', salt)).not.toBe(hasher.hash('tsk_live_b', salt));
    });
  });

  describe('verify', () => {
    it('returns true for the matching raw/salt/hash triple', () => {
      const key = hasher.generate('tsk_live');
      expect(hasher.verify(key.raw, key.salt, key.hash)).toBe(true);
    });

    it('returns false on a different raw with the same salt', () => {
      const key = hasher.generate('tsk_live');
      const other = hasher.generate('tsk_live');
      expect(hasher.verify(other.raw, key.salt, key.hash)).toBe(false);
    });

    it('returns false for a malformed hash length', () => {
      expect(hasher.verify('any', 'salt', 'ab')).toBe(false);
    });
  });

  describe('parse', () => {
    it('splits at the last underscore so prefixes may contain underscores', () => {
      const parsed = hasher.parse('tsk_live_ABCD-1234-EFGH');
      expect(parsed).toEqual({ prefix: 'tsk_live', last4: 'EFGH' });
    });

    it('returns null when the token has no underscore', () => {
      expect(hasher.parse('nounderscore')).toBeNull();
    });

    it('returns null when the suffix is shorter than 4 chars', () => {
      expect(hasher.parse('tsk_ab')).toBeNull();
    });
  });
});
