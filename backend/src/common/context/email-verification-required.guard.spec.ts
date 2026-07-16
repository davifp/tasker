import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { EmailVerificationRequiredGuard } from './email-verification-required.guard';
import { PrismaService } from '../../prisma/prisma.service';

const prismaClient = {
  user: { findUnique: vi.fn() },
};

const mockPrisma = { forSystem: vi.fn().mockReturnValue(prismaClient) };

function makeContext(user: { userId: string; sessionId: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('EmailVerificationRequiredGuard', () => {
  let guard: EmailVerificationRequiredGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.forSystem.mockReturnValue(prismaClient);
    guard = new EmailVerificationRequiredGuard(mockPrisma as unknown as PrismaService);
  });

  it('returns true when email is verified', async () => {
    prismaClient.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });

    const result = await guard.canActivate(makeContext({ userId: 'u1', sessionId: 's1' }));

    expect(result).toBe(true);
  });

  it('throws ForbiddenException with the problem type when email is not verified', async () => {
    prismaClient.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: null });

    await expect(guard.canActivate(makeContext({ userId: 'u1', sessionId: 's1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns false when there is no authenticated user', async () => {
    const result = await guard.canActivate(makeContext(undefined));
    expect(result).toBe(false);
  });
});
