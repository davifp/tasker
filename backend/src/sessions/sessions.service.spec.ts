import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnauthorizedException } from '@nestjs/common';
import { SessionsService, DeviceMeta } from './sessions.service';
import { TokenService } from '../common/security/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthEvents } from '../auth/events/auth.events';

const DEVICE: DeviceMeta = { deviceLabel: 'test-browser', userAgent: 'vitest', ip: '127.0.0.1' };
const SESSION_ID = 'session-cuid-1';
const RAW_TOKEN = 'random-base64url-token';
const TOKEN_HASH = 'sha256-hash-of-raw-token';

function makeSession(
  overrides: Partial<{
    revokedAt: Date | null;
    expiresAt: Date;
    refreshHash: string;
  }> = {},
) {
  return {
    id: SESSION_ID,
    userId: 'user-1',
    refreshHash: TOKEN_HASH,
    deviceLabel: 'test-browser',
    userAgent: 'vitest',
    ip: '127.0.0.1',
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SessionsService', () => {
  let service: SessionsService;
  let mockPrisma: { forSystem: ReturnType<typeof vi.fn> };
  let mockTokenService: Partial<TokenService>;
  let mockEvents: Partial<EventEmitter2>;
  let sessionDb: ReturnType<typeof makeSession> | null;

  beforeEach(async () => {
    sessionDb = makeSession();

    mockTokenService = {
      newRefresh: vi.fn().mockReturnValue({ token: RAW_TOKEN, hash: TOKEN_HASH }),
      hash: vi
        .fn()
        .mockImplementation((t: string) => (t === RAW_TOKEN ? TOKEN_HASH : `hash-of-${t}`)),
      signAccess: vi.fn().mockReturnValue('jwt-access-token'),
    };

    mockEvents = {
      emit: vi.fn(),
    };

    const mockDb = {
      session: {
        create: vi.fn().mockImplementation(({ data }) => ({
          ...makeSession(),
          id: SESSION_ID,
          ...data,
        })),
        findUnique: vi.fn().mockImplementation(() => sessionDb),
        update: vi.fn().mockImplementation(({ data }) => ({ ...sessionDb, ...data })),
      },
    };

    mockPrisma = {
      forSystem: vi.fn().mockReturnValue(mockDb),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, def: number) => def },
        },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile();

    service = moduleRef.get(SessionsService);
  });

  describe('create()', () => {
    it('returns session and refresh token with sessionId prefix', async () => {
      const { session, refresh } = await service.create('user-1', DEVICE);
      expect(session.id).toBe(SESSION_ID);
      expect(refresh).toBe(`${SESSION_ID}.${RAW_TOKEN}`);
    });
  });

  describe('rotate()', () => {
    it('issues new access + refresh tokens for a valid refresh', async () => {
      const refresh = `${SESSION_ID}.${RAW_TOKEN}`;
      const result = await service.rotate(refresh, DEVICE);
      expect(result.access).toBe('jwt-access-token');
      expect(result.refresh).toContain(`${SESSION_ID}.`);
    });

    it('emits REFRESH_ROTATED event on success', async () => {
      await service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE);
      expect(mockEvents.emit).toHaveBeenCalledWith(
        AuthEvents.REFRESH_ROTATED,
        expect.objectContaining({ sessionId: SESSION_ID }),
      );
    });

    it('throws UnauthorizedException when token hash does not match (reuse)', async () => {
      sessionDb = makeSession({ refreshHash: 'different-hash' });
      await expect(service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('emits REUSE_DETECTED event on hash mismatch', async () => {
      sessionDb = makeSession({ refreshHash: 'different-hash' });
      await service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE).catch(() => {});
      expect(mockEvents.emit).toHaveBeenCalledWith(
        AuthEvents.REUSE_DETECTED,
        expect.objectContaining({ sessionId: SESSION_ID }),
      );
    });

    it('revokes the session on reuse detection if not already revoked', async () => {
      sessionDb = makeSession({ refreshHash: 'different-hash', revokedAt: null });
      const db = mockPrisma.forSystem();
      await service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE).catch(() => {});
      expect(db.session.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      );
    });

    it('throws UnauthorizedException when session is revoked', async () => {
      sessionDb = makeSession({ revokedAt: new Date() });
      await expect(service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when session is expired', async () => {
      sessionDb = makeSession({ expiresAt: new Date(Date.now() - 1000) });
      await expect(service.rotate(`${SESSION_ID}.${RAW_TOKEN}`, DEVICE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for malformed token (no dot separator)', async () => {
      await expect(service.rotate('no-separator', DEVICE)).rejects.toThrow(UnauthorizedException);
    });

    it('throws when session is not found', async () => {
      sessionDb = null;
      await expect(service.rotate(`unknown.${RAW_TOKEN}`, DEVICE)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('revoke()', () => {
    it('sets revokedAt on the session', async () => {
      const db = mockPrisma.forSystem();
      await service.revoke(SESSION_ID, 'user-1');
      expect(db.session.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      );
    });

    it('emits SESSION_REVOKED event', async () => {
      await service.revoke(SESSION_ID, 'user-1');
      expect(mockEvents.emit).toHaveBeenCalledWith(
        AuthEvents.SESSION_REVOKED,
        expect.objectContaining({ sessionId: SESSION_ID, actorUserId: 'user-1' }),
      );
    });

    it('is a no-op when session is already revoked', async () => {
      sessionDb = makeSession({ revokedAt: new Date() });
      const db = mockPrisma.forSystem();
      await service.revoke(SESSION_ID, 'user-1');
      expect(db.session.update).not.toHaveBeenCalled();
    });
  });
});
