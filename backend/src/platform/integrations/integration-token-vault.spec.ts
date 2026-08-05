import { describe, expect, it } from 'vitest';
import { IntegrationTokenVault } from './integration-token-vault';

describe('IntegrationTokenVault', () => {
  const vault = new IntegrationTokenVault('a-32-byte-master-key-for-testing-only');

  it('round-trips a plaintext through seal → open', () => {
    const sealed = vault.seal('ghp_secret-token-value');
    expect(vault.open(sealed)).toBe('ghp_secret-token-value');
  });

  it('produces distinct nonce + ciphertext each call', () => {
    const a = vault.seal('same-plaintext');
    const b = vault.seal('same-plaintext');
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects tampered ciphertext via the auth tag', () => {
    const sealed = vault.seal('token');
    const first = sealed.ciphertext[0]!;
    const tampered = {
      ...sealed,
      ciphertext: (first === '0' ? '1' : '0') + sealed.ciphertext.slice(1),
    };
    expect(() => vault.open(tampered)).toThrow();
  });

  it('rejects a token opened under a different key', () => {
    const sealed = vault.seal('token');
    const other = new IntegrationTokenVault('a-different-master-key-32-chars-x');
    expect(() => other.open(sealed)).toThrow();
  });
});
