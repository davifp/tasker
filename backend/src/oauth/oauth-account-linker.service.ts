import { ConflictException, Injectable } from '@nestjs/common';
import { OAuthProvider, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OAuthProfile {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
}

@Injectable()
export class OAuthAccountLinker {
  constructor(private readonly prisma: PrismaService) {}

  // Resolves an OAuth callback profile to a User, applying the four-outcome
  // matrix from the techspec:
  //   1. OAuthAccount exists            → return its user (sign-in)
  //   2. Email matches verified User    → create OAuthAccount, link, return user
  //   3. Email matches unverified User  → 409 oauth-verify-first, no writes
  //   4. No match                       → create User + OAuthAccount, return user
  async resolveOAuthLogin(profile: OAuthProfile): Promise<User> {
    const db = this.prisma.forSystem();

    const existingLink = await db.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });

    if (existingLink) {
      return existingLink.user;
    }

    const userWithEmail = await db.user.findUnique({ where: { email: profile.email } });

    if (userWithEmail && !userWithEmail.emailVerifiedAt) {
      throw new ConflictException({
        type: 'https://tasker.dev/problems/oauth-verify-first',
        title: 'Verify your email first',
        detail:
          'An unverified account already exists for this email. Verify it before linking an OAuth provider.',
        status: 409,
      });
    }

    if (userWithEmail) {
      await db.oAuthAccount.create({
        data: {
          userId: userWithEmail.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      return userWithEmail;
    }

    // Brand-new signup via OAuth. Trust the provider's email-verified flag —
    // Google and GitHub both mark primary emails as verified when they are.
    // User + OAuthAccount are created inside a single interactive transaction
    // so we never end up with an orphan User if the second write fails.
    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
        },
      });
      await tx.oAuthAccount.create({
        data: {
          userId: user.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      return user;
    });
  }
}
