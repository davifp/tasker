import { ConfigService } from '@nestjs/config';
import { IntegrationTokenVault } from './integration-token-vault';

export const integrationTokenVaultProvider = {
  provide: IntegrationTokenVault,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IntegrationTokenVault => {
    const masterKey = config.get<string>('JWT_SECRET');
    if (!masterKey) {
      throw new Error('JWT_SECRET is required to derive the integration token vault key');
    }
    return new IntegrationTokenVault(masterKey);
  },
};
