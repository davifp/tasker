import { describe, it, expect } from 'vitest';
import { maskSensitiveMetadata } from './mask-sensitive';

describe('maskSensitiveMetadata', () => {
  it('replaces top-level sensitive values with [masked]', () => {
    const input = {
      email: 'a@b.test',
      password: 'plaintext',
      apiKey: 'sk-secret',
      token: 'bearer.jwt.here',
      mfaSecret: 'S3CR3T',
    };
    const output = maskSensitiveMetadata(input) as Record<string, string>;
    expect(output.email).toBe('a@b.test');
    expect(output.password).toBe('[masked]');
    expect(output.apiKey).toBe('[masked]');
    expect(output.token).toBe('[masked]');
    expect(output.mfaSecret).toBe('[masked]');
  });

  it('is case-insensitive on key names', () => {
    const output = maskSensitiveMetadata({
      Authorization: 'Bearer x',
      PASSWORD_HASH: 'argon2$...',
    }) as Record<string, string>;
    expect(output.Authorization).toBe('[masked]');
    expect(output.PASSWORD_HASH).toBe('[masked]');
  });

  it('recurses into nested objects and arrays', () => {
    const output = maskSensitiveMetadata({
      before: { password: 'a', title: 't1' },
      after: { password: 'b', title: 't2' },
      chain: [{ token: 'x' }, { token: 'y' }],
    }) as {
      before: Record<string, string>;
      after: Record<string, string>;
      chain: Array<Record<string, string>>;
    };
    expect(output.before.password).toBe('[masked]');
    expect(output.before.title).toBe('t1');
    expect(output.after.password).toBe('[masked]');
    expect(output.chain[0].token).toBe('[masked]');
    expect(output.chain[1].token).toBe('[masked]');
  });

  it('passes primitives and nulls through untouched', () => {
    expect(maskSensitiveMetadata(null)).toBeNull();
    expect(maskSensitiveMetadata('hello')).toBe('hello');
    expect(maskSensitiveMetadata(42)).toBe(42);
    expect(maskSensitiveMetadata(true)).toBe(true);
  });
});
