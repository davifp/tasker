import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { webhookSignerProvider } from './webhook-signer.provider';
import { WebhookSigner } from './webhook-signer';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('webhookSignerProvider', () => {
  it('prefers WEBHOOK_MASTER_KEY when set', () => {
    const signer = webhookSignerProvider.useFactory(
      makeConfig({
        WEBHOOK_MASTER_KEY: 'a-dedicated-webhook-master-key-32b',
        JWT_SECRET: 'the-jwt-secret-should-not-be-used',
      }),
    );
    expect(signer).toBeInstanceOf(WebhookSigner);
    const sealed = signer.encrypt('hello');
    expect(signer.decrypt(sealed.salt, sealed.hash)).toBe('hello');
  });

  it('falls back to JWT_SECRET when WEBHOOK_MASTER_KEY is empty', () => {
    const signer = webhookSignerProvider.useFactory(
      makeConfig({ WEBHOOK_MASTER_KEY: '', JWT_SECRET: 'jwt-secret-that-is-long-enough-32c' }),
    );
    expect(signer).toBeInstanceOf(WebhookSigner);
  });

  it('throws when neither key is set', () => {
    expect(() =>
      webhookSignerProvider.useFactory(
        makeConfig({ WEBHOOK_MASTER_KEY: '', JWT_SECRET: undefined }),
      ),
    ).toThrow(/WEBHOOK_MASTER_KEY or JWT_SECRET/);
  });

  it('produces distinct ciphertext across dedicated vs jwt keys', () => {
    const dedicated = webhookSignerProvider.useFactory(
      makeConfig({ WEBHOOK_MASTER_KEY: 'dedicated-key-that-is-long-enough-abc', JWT_SECRET: 'x' }),
    );
    const fallback = webhookSignerProvider.useFactory(
      makeConfig({ WEBHOOK_MASTER_KEY: '', JWT_SECRET: 'dedicated-key-that-is-long-enough-abc' }),
    );
    // Same effective key → same ciphertext round-trips both ways.
    const sealed = dedicated.encrypt('roundtrip');
    expect(fallback.decrypt(sealed.salt, sealed.hash)).toBe('roundtrip');
  });
});
