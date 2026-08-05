import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { webhookBackoffStrategy } from './webhook-backoff.strategy';

describe('webhookBackoffStrategy', () => {
  const originalBase = process.env['WEBHOOK_BACKOFF_BASE_MS'];
  const originalCap = process.env['WEBHOOK_BACKOFF_CAP_MS'];

  beforeEach(() => {
    delete process.env['WEBHOOK_BACKOFF_BASE_MS'];
    delete process.env['WEBHOOK_BACKOFF_CAP_MS'];
  });

  afterEach(() => {
    if (originalBase === undefined) delete process.env['WEBHOOK_BACKOFF_BASE_MS'];
    else process.env['WEBHOOK_BACKOFF_BASE_MS'] = originalBase;
    if (originalCap === undefined) delete process.env['WEBHOOK_BACKOFF_CAP_MS'];
    else process.env['WEBHOOK_BACKOFF_CAP_MS'] = originalCap;
  });

  it('doubles each attempt from the base until it hits the cap', () => {
    process.env['WEBHOOK_BACKOFF_BASE_MS'] = '1000';
    process.env['WEBHOOK_BACKOFF_CAP_MS'] = '60000';
    expect(webhookBackoffStrategy(1)).toBe(1000);
    expect(webhookBackoffStrategy(2)).toBe(2000);
    expect(webhookBackoffStrategy(3)).toBe(4000);
    expect(webhookBackoffStrategy(4)).toBe(8000);
    expect(webhookBackoffStrategy(5)).toBe(16000);
    expect(webhookBackoffStrategy(6)).toBe(32000);
    expect(webhookBackoffStrategy(7)).toBe(60000); // clamped: 64000 → 60000
    expect(webhookBackoffStrategy(24)).toBe(60000); // still clamped
  });

  it('uses safe defaults when env vars are missing or invalid', () => {
    expect(webhookBackoffStrategy(1)).toBe(1000);
    process.env['WEBHOOK_BACKOFF_BASE_MS'] = 'nope';
    process.env['WEBHOOK_BACKOFF_CAP_MS'] = '-1';
    expect(webhookBackoffStrategy(1)).toBe(1000);
    expect(webhookBackoffStrategy(30)).toBe(3_600_000);
  });

  it('never returns a negative or zero delay', () => {
    process.env['WEBHOOK_BACKOFF_BASE_MS'] = '500';
    process.env['WEBHOOK_BACKOFF_CAP_MS'] = '10000';
    expect(webhookBackoffStrategy(0)).toBeGreaterThan(0);
    expect(webhookBackoffStrategy(-1)).toBeGreaterThan(0);
  });
});
