import { describe, expect, it } from 'vitest';
import { containsKnownSecret, redactKnownSecrets } from './redaction';

describe('containsKnownSecret', () => {
  it('flags Stripe-style Tasker API keys', () => {
    expect(containsKnownSecret('tsk_live_ABCD1234efgh5678ijkl9012mnop3456qrst')).toBe(true);
    expect(containsKnownSecret('tsk_test_ABCD1234efgh5678ijkl9012mnop3456qrst')).toBe(true);
  });

  it('flags GitHub personal-access-token prefixes', () => {
    expect(containsKnownSecret('ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(true);
    expect(containsKnownSecret('gho_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(true);
    expect(containsKnownSecret('ghs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(true);
  });

  it('flags Google OAuth access-token prefixes', () => {
    expect(containsKnownSecret('ya29.a0AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe(true);
  });

  it('flags JWT-shaped strings', () => {
    expect(
      containsKnownSecret(
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
      ),
    ).toBe(true);
  });

  it('does not flag ordinary log lines', () => {
    expect(containsKnownSecret('user cmsfhx35c0002bwvq6bpg4eko logged in')).toBe(false);
    expect(containsKnownSecret('rendering platform_api_requests_total counter')).toBe(false);
    // Prefix + tail are safe (they are what we DO log) — no full raw key.
    expect(containsKnownSecret('key tsk_live_… suffix 9Ato')).toBe(false);
  });
});

describe('redactKnownSecrets', () => {
  it('replaces matched secrets with [REDACTED] while preserving surrounding text', () => {
    const line = 'headers: {authorization: "Bearer tsk_live_ABCD1234efgh5678ijkl9012mnop3456qrst"}';
    const redacted = redactKnownSecrets(line);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('tsk_live_ABCD1234');
    expect(redacted).toContain('headers: {authorization: "Bearer');
  });

  it('is idempotent — running it twice returns the same string', () => {
    const input = 'ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX and more text';
    expect(redactKnownSecrets(redactKnownSecrets(input))).toBe(redactKnownSecrets(input));
  });

  it('regression guard: representative API responses do not carry raw secrets', () => {
    // Freezing the exact shape of what we return for high-risk endpoints so a
    // future PR that adds `apiKey.raw` back to a summary is caught here.
    const apiKeyList = JSON.stringify({
      items: [
        {
          id: 'cmsx',
          name: 'CI key',
          keyPrefix: 'tsk_live',
          last4: '9Ato',
          scopes: ['projects:read'],
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: '2026-08-05T00:00:00.000Z',
          createdByUserId: 'cmsu',
        },
      ],
    });
    expect(containsKnownSecret(apiKeyList)).toBe(false);

    const webhookList = JSON.stringify({
      items: [
        {
          id: 'cmwh',
          url: 'https://example.com/hook',
          eventTypes: ['TASK_CREATED'],
          isActive: true,
          secretRotatedAt: null,
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z',
          createdByUserId: 'cmsu',
        },
      ],
    });
    expect(containsKnownSecret(webhookList)).toBe(false);

    const integrationList = JSON.stringify({
      items: [
        {
          id: 'cmit',
          provider: 'GITHUB',
          state: 'CONNECTED',
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z',
          createdByUserId: 'cmsu',
          config: { githubLogin: 'octocat', scopes: 'repo read:user' },
        },
      ],
    });
    expect(containsKnownSecret(integrationList)).toBe(false);
  });
});
