import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { createHash } from 'node:crypto';

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-that-is-at-least-32-chars',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [TokenService],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  describe('signAccess / verifyAccess', () => {
    it('round-trips a payload through JWT sign and verify', () => {
      const payload = { sub: 'user-1', sid: 'session-1' };
      const token = service.signAccess(payload);
      const decoded = service.verifyAccess(token);
      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.sid).toBe(payload.sid);
    });

    it('verifyAccess throws on a tampered token', () => {
      const token = service.signAccess({ sub: 'u', sid: 's' });
      expect(() => service.verifyAccess(token + 'x')).toThrow();
    });
  });

  describe('newRefresh()', () => {
    it('returns a base64url token and its sha256 hash', () => {
      const { token, hash } = service.newRefresh();
      const expected = createHash('sha256').update(token).digest('hex');
      expect(hash).toBe(expected);
    });

    it('token has at least 256 bits of entropy (≥ 32 bytes → 43 base64url chars)', () => {
      const { token } = service.newRefresh();
      // 32 bytes base64url = 43 chars (ceil(32*4/3) without padding)
      expect(token.length).toBeGreaterThanOrEqual(43);
    });

    it('generates unique tokens on each call', () => {
      const { token: t1 } = service.newRefresh();
      const { token: t2 } = service.newRefresh();
      expect(t1).not.toBe(t2);
    });
  });

  describe('hash()', () => {
    it('produces a deterministic sha256 hex string', () => {
      const h1 = service.hash('hello');
      const h2 = service.hash('hello');
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different inputs', () => {
      expect(service.hash('a')).not.toBe(service.hash('b'));
    });
  });
});
