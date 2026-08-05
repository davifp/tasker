import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { integrationTokenVaultProvider } from './integration-token-vault.provider';
import { IntegrationTokenVault } from './integration-token-vault';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('integrationTokenVaultProvider', () => {
  it('prefers INTEGRATION_MASTER_KEY when set', () => {
    const vault = integrationTokenVaultProvider.useFactory(
      makeConfig({
        INTEGRATION_MASTER_KEY: 'integration-master-key-that-is-32ch',
        JWT_SECRET: 'jwt-should-not-be-used-here-at-all',
      }),
    );
    expect(vault).toBeInstanceOf(IntegrationTokenVault);
    const sealed = vault.seal('access-token');
    expect(vault.open(sealed)).toBe('access-token');
  });

  it('falls back to JWT_SECRET when dedicated key is empty', () => {
    const vault = integrationTokenVaultProvider.useFactory(
      makeConfig({ INTEGRATION_MASTER_KEY: '', JWT_SECRET: 'jwt-secret-that-is-long-enough-3' }),
    );
    expect(vault).toBeInstanceOf(IntegrationTokenVault);
  });

  it('throws when neither key is set', () => {
    expect(() =>
      integrationTokenVaultProvider.useFactory(
        makeConfig({ INTEGRATION_MASTER_KEY: '', JWT_SECRET: undefined }),
      ),
    ).toThrow(/INTEGRATION_MASTER_KEY or JWT_SECRET/);
  });
});
