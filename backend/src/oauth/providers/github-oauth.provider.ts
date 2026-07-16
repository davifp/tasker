import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';
import { OAuthProfile } from '../oauth-account-linker.service';
import { OAuthProviderClient } from './oauth-provider.interface';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';
const SCOPES = 'read:user user:email';

interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GithubOAuthProvider implements OAuthProviderClient {
  readonly provider: OAuthProvider = 'GITHUB';

  constructor(private readonly config: ConfigService) {}

  buildAuthorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      allow_signup: 'true',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async fetchProfile({
    code,
    redirectUri,
  }: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthProfile> {
    const tokenBody = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      throw new BadRequestException(`GitHub token exchange failed (${tokenRes.status})`);
    }
    const tokenJson = (await tokenRes.json()) as GithubTokenResponse;

    const authHeader = {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: 'application/vnd.github+json',
    };

    const [userRes, emailsRes] = await Promise.all([
      fetch(USER_URL, { headers: authHeader }),
      fetch(EMAILS_URL, { headers: authHeader }),
    ]);

    if (!userRes.ok) {
      throw new BadRequestException(`GitHub user fetch failed (${userRes.status})`);
    }
    if (!emailsRes.ok) {
      throw new BadRequestException(`GitHub emails fetch failed (${emailsRes.status})`);
    }

    const user = (await userRes.json()) as GithubUser;
    const emails = (await emailsRes.json()) as GithubEmail[];

    // Primary + verified email is authoritative for account identity; fall back
    // to the public profile email only if the primary is missing.
    const primary =
      emails.find((e) => e.primary && e.verified) ??
      emails.find((e) => e.verified) ??
      (user.email ? { email: user.email, primary: true, verified: false } : undefined);

    if (!primary) {
      throw new BadRequestException('GitHub profile did not include an email address');
    }

    return {
      provider: 'GITHUB',
      providerAccountId: String(user.id),
      email: primary.email.toLowerCase(),
      emailVerified: primary.verified === true,
      displayName: user.name ?? user.login,
      avatarUrl: user.avatar_url ?? undefined,
    };
  }

  private clientId(): string {
    const id = this.config.get<string>('GITHUB_CLIENT_ID', '');
    if (!id) throw new BadRequestException('GitHub OAuth is not configured on this server');
    return id;
  }

  private clientSecret(): string {
    const secret = this.config.get<string>('GITHUB_CLIENT_SECRET', '');
    if (!secret) throw new BadRequestException('GitHub OAuth is not configured on this server');
    return secret;
  }
}
