import { ConfigService } from '@nestjs/config';
import { WebhookSigner } from './webhook-signer';

export const webhookSignerProvider = {
  provide: WebhookSigner,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WebhookSigner => {
    const masterKey = config.get<string>('JWT_SECRET');
    if (!masterKey) {
      throw new Error('JWT_SECRET is required to derive the webhook encryption key');
    }
    return new WebhookSigner(masterKey);
  },
};
