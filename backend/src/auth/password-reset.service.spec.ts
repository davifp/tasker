import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PasswordResetService } from './password-reset.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { Argon2Service } from '../common/security/argon2.service';
import { MAIL_PROVIDER } from '../common/mail/mail.provider';

const now = new Date('2024-06-01T12:00:00Z');
const future = new Date('2024-06-02T12:00:00Z');
const past = new Date('2024-05-31T12:00:00Z');

const prismaClient = {
  user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  passwordResetToken: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  session: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
};

const mockPrisma = { forSystem: vi.fn().mockReturnValue(prismaClient) };

const mockTokenService = {
  generateToken: vi.fn().mockReturnValue({ token: 'raw-reset', hash: 'hashed-reset' }),
  hash: vi.fn().mockReturnValue('hashed-reset'),
};

const mockArgon2 = { hash: vi.fn().mockResolvedValue('$argon2id$...new') };

const mockMail = { send: vi.fn().mockResolvedValue({ jobId: 'j1' }) };

const mockConfig = {
  get: vi.fn((key: string, def: unknown) => {
    if (key === 'PASSWORD_RESET_TTL_S') return 3600;
    if (key === 'APP_BASE_URL') return 'http://localhost:3000';
    return def;
  }),
};

async function buildService(): Promise<PasswordResetService> {
  const module = await Test.createTestingModule({
    providers: [
      PasswordResetService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: TokenService, useValue: mockTokenService },
      { provide: Argon2Service, useValue: mockArgon2 },
      { provide: MAIL_PROVIDER, useValue: mockMail },
      { provide: ConfigService, useValue: mockConfig },
      { provide: EventEmitter2, useValue: { emit: vi.fn() } },
    ],
  }).compile();
  return module.get(PasswordResetService);
}

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    mockPrisma.forSystem.mockReturnValue(prismaClient);
    service = await buildService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requestReset()', () => {
    it('returns without sending an email when email is not found (no enumeration)', async () => {
      prismaClient.user.findUnique.mockResolvedValueOnce(null);

      await service.requestReset('unknown@example.com');

      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('enqueues a reset email when the email exists', async () => {
      prismaClient.user.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'user@example.com' });

      await service.requestReset('user@example.com');

      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'password-reset',
          to: 'user@example.com',
          variables: expect.objectContaining({ resetUrl: expect.stringContaining('raw-reset') }),
        }),
      );
    });
  });

  describe('confirmReset()', () => {
    it('updates password and revokes all sessions atomically on valid token', async () => {
      prismaClient.passwordResetToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-reset',
        userId: 'u1',
        expiresAt: future,
        consumedAt: null,
      });

      await service.confirmReset('raw-reset', 'new-password-123');

      expect(mockArgon2.hash).toHaveBeenCalledWith('new-password-123');
      expect(prismaClient.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaClient.$transaction).toHaveBeenCalled();
    });

    it('throws GoneException for an expired reset token', async () => {
      prismaClient.passwordResetToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-reset',
        userId: 'u1',
        expiresAt: past,
        consumedAt: null,
      });

      await expect(service.confirmReset('raw-reset', 'new-password')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('throws GoneException for an already consumed reset token', async () => {
      prismaClient.passwordResetToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-reset',
        userId: 'u1',
        expiresAt: future,
        consumedAt: now,
      });

      await expect(service.confirmReset('raw-reset', 'new-password')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('throws GoneException when token does not exist', async () => {
      prismaClient.passwordResetToken.findUnique.mockResolvedValueOnce(null);

      await expect(service.confirmReset('no-such-token', 'password')).rejects.toBeInstanceOf(
        GoneException,
      );
    });
  });
});
