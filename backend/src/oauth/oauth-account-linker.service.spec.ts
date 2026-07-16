import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OAuthAccountLinker, OAuthProfile } from './oauth-account-linker.service';
import { PrismaService } from '../prisma/prisma.service';

const prismaClient = {
  oAuthAccount: {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prismaClient) => Promise<unknown>)(prismaClient);
    }
    return Promise.all(arg as unknown[]);
  }),
};

const mockPrisma = { forSystem: vi.fn().mockReturnValue(prismaClient) };

async function buildLinker(): Promise<OAuthAccountLinker> {
  const module = await Test.createTestingModule({
    providers: [OAuthAccountLinker, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
  return module.get(OAuthAccountLinker);
}

const baseProfile: OAuthProfile = {
  provider: 'GOOGLE',
  providerAccountId: 'google-123',
  email: 'user@example.com',
  emailVerified: true,
  displayName: 'Alice',
  avatarUrl: 'https://cdn.example.com/a.png',
};

describe('OAuthAccountLinker.resolveOAuthLogin', () => {
  let linker: OAuthAccountLinker;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.forSystem.mockReturnValue(prismaClient);
    prismaClient.oAuthAccount.findUnique.mockReset();
    prismaClient.oAuthAccount.create.mockReset().mockResolvedValue({});
    prismaClient.user.findUnique.mockReset();
    prismaClient.user.create.mockReset();
    linker = await buildLinker();
  });

  it('outcome 1 — existing OAuthAccount returns the linked user unchanged', async () => {
    prismaClient.oAuthAccount.findUnique.mockResolvedValueOnce({
      user: { id: 'u-existing', email: baseProfile.email, emailVerifiedAt: new Date() },
    });

    const user = await linker.resolveOAuthLogin(baseProfile);

    expect(user.id).toBe('u-existing');
    expect(prismaClient.user.create).not.toHaveBeenCalled();
    expect(prismaClient.oAuthAccount.create).not.toHaveBeenCalled();
  });

  it('outcome 2 — verified local user gets an OAuthAccount linked and is returned', async () => {
    prismaClient.oAuthAccount.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.findUnique.mockResolvedValueOnce({
      id: 'u-verified',
      email: baseProfile.email,
      emailVerifiedAt: new Date(),
    });

    const user = await linker.resolveOAuthLogin(baseProfile);

    expect(user.id).toBe('u-verified');
    expect(prismaClient.oAuthAccount.create).toHaveBeenCalledWith({
      data: {
        userId: 'u-verified',
        provider: 'GOOGLE',
        providerAccountId: 'google-123',
      },
    });
    expect(prismaClient.user.create).not.toHaveBeenCalled();
  });

  it('outcome 3 — unverified local user throws 409 with oauth-verify-first type and writes nothing', async () => {
    prismaClient.oAuthAccount.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.findUnique.mockResolvedValueOnce({
      id: 'u-unverified',
      email: baseProfile.email,
      emailVerifiedAt: null,
    });

    try {
      await linker.resolveOAuthLogin(baseProfile);
      expect.fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as { type: string; status: number };
      expect(response.type).toBe('https://tasker.dev/problems/oauth-verify-first');
      expect(response.status).toBe(409);
    }
    expect(prismaClient.oAuthAccount.create).not.toHaveBeenCalled();
    expect(prismaClient.user.create).not.toHaveBeenCalled();
  });

  it('outcome 4 — no match creates a new User and OAuthAccount', async () => {
    prismaClient.oAuthAccount.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.create.mockResolvedValueOnce({
      id: 'u-new',
      email: baseProfile.email,
      emailVerifiedAt: new Date(),
    });

    const user = await linker.resolveOAuthLogin(baseProfile);

    expect(user.id).toBe('u-new');
    expect(prismaClient.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: baseProfile.email,
        displayName: baseProfile.displayName,
        avatarUrl: baseProfile.avatarUrl,
        emailVerifiedAt: expect.any(Date),
      }),
    });
    expect(prismaClient.oAuthAccount.create).toHaveBeenCalledWith({
      data: { userId: 'u-new', provider: 'GOOGLE', providerAccountId: 'google-123' },
    });
  });

  it('outcome 4 — new user with unverified provider email leaves emailVerifiedAt null', async () => {
    prismaClient.oAuthAccount.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.findUnique.mockResolvedValueOnce(null);
    prismaClient.user.create.mockResolvedValueOnce({
      id: 'u-new',
      email: baseProfile.email,
      emailVerifiedAt: null,
    });

    await linker.resolveOAuthLogin({ ...baseProfile, emailVerified: false });

    expect(prismaClient.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ emailVerifiedAt: null }),
    });
  });
});
