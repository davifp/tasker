import { describe, it, expect } from 'vitest';
import { encodeSession, decodeSession, isExpiring } from './session';
import type { SessionPayload } from './session';

const now = () => Math.floor(Date.now() / 1000);

describe('session encode/decode', () => {
  it('round-trips a session payload through iron-session sealing', async () => {
    const payload: SessionPayload = {
      userId: 'user-123',
      accessToken: 'access.jwt.token',
      refreshToken: 'refresh.jwt.token',
      accessExp: now() + 900,
    };

    const sealed = await encodeSession(payload);
    const decoded = await decodeSession(sealed);

    expect(decoded).toEqual(payload);
  });

  it('returns null on tampered ciphertext', async () => {
    const decoded = await decodeSession('not-a-valid-sealed-value');
    expect(decoded).toBeNull();
  });
});

describe('isExpiring', () => {
  it('flags tokens within the refresh leeway as expiring', () => {
    const t = now();
    expect(
      isExpiring({ userId: 'u', accessToken: 'a', refreshToken: 'r', accessExp: t + 30 }, t),
    ).toBe(true);
  });

  it('flags already-expired tokens as expiring', () => {
    const t = now();
    expect(
      isExpiring({ userId: 'u', accessToken: 'a', refreshToken: 'r', accessExp: t - 5 }, t),
    ).toBe(true);
  });

  it('does not flag comfortably valid tokens', () => {
    const t = now();
    expect(
      isExpiring({ userId: 'u', accessToken: 'a', refreshToken: 'r', accessExp: t + 600 }, t),
    ).toBe(false);
  });
});
