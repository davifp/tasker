import { ConfigService } from '@nestjs/config';
import { IntegrationTokenVault } from './integration-token-vault';

export const integrationTokenVaultProvider = {
  provide: IntegrationTokenVault,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IntegrationTokenVault => {
    const dedicated = config.get<string>('INTEGRATION_MASTER_KEY');
    const masterKey =
      dedicated && dedicated.length > 0 ? dedicated : config.get<string>('JWT_SECRET');
    if (!masterKey) {
      throw new Error(
        'INTEGRATION_MASTER_KEY or JWT_SECRET is required to derive the integration token vault key',
      );
    }
    return new IntegrationTokenVault(masterKey);
  },
};
