import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';
import { OAuthProfile } from '../oauth-account-linker.service';
import { OAuthProviderClient } from './oauth-provider.interface';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = 'openid profile email';

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface GoogleUserinfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
}

@Injectable()
export class GoogleOAuthProvider implements OAuthProviderClient {
  readonly provider: OAuthProvider = 'GOOGLE';

  constructor(private readonly config: ConfigService) {}

  buildAuthorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      state,
      access_type: 'online',
      prompt: 'select_account',
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
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      throw new BadRequestException(`Google token exchange failed (${tokenRes.status})`);
    }
    const tokenJson = (await tokenRes.json()) as GoogleTokenResponse;

    const profileRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/json' },
    });
    if (!profileRes.ok) {
      throw new BadRequestException(`Google userinfo failed (${profileRes.status})`);
    }
    const profile = (await profileRes.json()) as GoogleUserinfo;

    if (!profile.email) {
      throw new BadRequestException('Google profile did not include an email address');
    }

    return {
      provider: 'GOOGLE',
      providerAccountId: profile.sub,
      email: profile.email.toLowerCase(),
      emailVerified: profile.email_verified === true,
      displayName: profile.name ?? profile.given_name ?? profile.email,
      avatarUrl: profile.picture,
    };
  }

  private clientId(): string {
    const id = this.config.get<string>('GOOGLE_CLIENT_ID', '');
    if (!id) throw new BadRequestException('Google OAuth is not configured on this server');
    return id;
  }

  private clientSecret(): string {
    const secret = this.config.get<string>('GOOGLE_CLIENT_SECRET', '');
    if (!secret) throw new BadRequestException('Google OAuth is not configured on this server');
    return secret;
  }
}
