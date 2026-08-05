import { ConfigService } from '@nestjs/config';
import { WebhookSigner } from './webhook-signer';

export const webhookSignerProvider = {
  provide: WebhookSigner,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WebhookSigner => {
    const dedicated = config.get<string>('WEBHOOK_MASTER_KEY');
    const masterKey =
      dedicated && dedicated.length > 0 ? dedicated : config.get<string>('JWT_SECRET');
    if (!masterKey) {
      throw new Error(
        'WEBHOOK_MASTER_KEY or JWT_SECRET is required to derive the webhook encryption key',
      );
    }
    return new WebhookSigner(masterKey);
  },
};
