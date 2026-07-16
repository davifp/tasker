import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailVerificationService } from './email-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { MAIL_PROVIDER } from '../common/mail/mail.provider';

const now = new Date('2024-06-01T12:00:00Z');
const future = new Date('2024-06-02T12:00:00Z');
const past = new Date('2024-05-31T12:00:00Z');

const mockPrisma = {
  forSystem: vi.fn(),
};

const prismaClient = {
  emailVerificationToken: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
};

const mockTokenService = {
  generateToken: vi.fn().mockReturnValue({ token: 'raw-token', hash: 'hashed-token' }),
  hash: vi.fn().mockReturnValue('hashed-token'),
};

const mockMailProvider = {
  send: vi.fn().mockResolvedValue({ jobId: 'j1' }),
};

const mockConfigService = {
  get: vi.fn((key: string, def: unknown) => {
    if (key === 'EMAIL_VERIFY_TTL_S') return 86400;
    if (key === 'APP_BASE_URL') return 'http://localhost:3000';
    return def;
  }),
};

async function buildService(): Promise<EmailVerificationService> {
  mockPrisma.forSystem.mockReturnValue(prismaClient);
  const module = await Test.createTestingModule({
    providers: [
      EmailVerificationService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: TokenService, useValue: mockTokenService },
      { provide: MAIL_PROVIDER, useValue: mockMailProvider },
      { provide: ConfigService, useValue: mockConfigService },
      { provide: EventEmitter2, useValue: { emit: vi.fn() } },
    ],
  }).compile();
  return module.get(EmailVerificationService);
}

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

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

  describe('verify()', () => {
    it('marks token consumed and user verified on valid token', async () => {
      prismaClient.emailVerificationToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-token',
        userId: 'u1',
        expiresAt: future,
        consumedAt: null,
      });

      await service.verify('raw-token');

      expect(prismaClient.$transaction).toHaveBeenCalled();
    });

    it('throws GoneException for an expired token', async () => {
      prismaClient.emailVerificationToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-token',
        userId: 'u1',
        expiresAt: past,
        consumedAt: null,
      });

      await expect(service.verify('raw-token')).rejects.toBeInstanceOf(GoneException);
    });

    it('throws GoneException for an already consumed token', async () => {
      prismaClient.emailVerificationToken.findUnique.mockResolvedValueOnce({
        tokenHash: 'hashed-token',
        userId: 'u1',
        expiresAt: future,
        consumedAt: now,
      });

      await expect(service.verify('raw-token')).rejects.toBeInstanceOf(GoneException);
    });

    it('throws GoneException when token record does not exist', async () => {
      prismaClient.emailVerificationToken.findUnique.mockResolvedValueOnce(null);

      await expect(service.verify('no-such-token')).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('resend()', () => {
    it('sends a new verification email when not yet verified', async () => {
      prismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        emailVerifiedAt: null,
      });

      await service.resend('u1');

      expect(mockMailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'email-verify', to: 'user@example.com' }),
      );
    });

    it('throws BadRequestException when email is already verified', async () => {
      prismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        emailVerifiedAt: now,
      });

      await expect(service.resend('u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sendVerificationEmail()', () => {
    it('enqueues mail with a verify URL containing the raw token', async () => {
      await service.sendVerificationEmail('u1', 'user@example.com');

      expect(mockMailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'email-verify',
          to: 'user@example.com',
          variables: expect.objectContaining({ verifyUrl: expect.stringContaining('raw-token') }),
        }),
      );
    });
  });
});
