import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationTokenVault } from '../integration-token-vault';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// Narrowest scope that lets us create + update events on the user's chosen
// calendar. `calendar.events` does NOT grant read access to other events on
// the calendar — just write access to events we authored — which is exactly
// what a one-way export needs.
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
}

export interface GoogleConnectResult {
  integrationId: string;
  googleEmail: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly httpTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: IntegrationTokenVault,
    private readonly config: ConfigService,
  ) {
    this.httpTimeoutMs = config.get<number>('INTEGRATION_HTTP_TIMEOUT_MS', 15_000);
  }

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  scopesForConsentCopy(): readonly string[] {
    return GOOGLE_SCOPES.split(' ');
  }

  async completeConnection({
    code,
    redirectUri,
    workspaceId,
    actorUserId,
  }: {
    code: string;
    redirectUri: string;
    workspaceId: string;
    actorUserId: string;
  }): Promise<GoogleConnectResult> {
    const token = await this.exchangeCode(code, redirectUri);
    const profile = await this.fetchProfile(token.access_token);

    const oauthAccount = await this.prisma.forSystem().oAuthAccount.upsert({
      where: {
        provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: profile.sub },
      },
      create: {
        userId: actorUserId,
        provider: 'GOOGLE',
        providerAccountId: profile.sub,
      },
      update: {},
    });

    const sealedAccess = this.vault.seal(token.access_token);
    const sealedRefresh = token.refresh_token ? this.vault.seal(token.refresh_token) : null;

    const config: Record<string, unknown> = {
      googleEmail: profile.email,
      scopes: token.scope,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      tokenCiphertext: sealedAccess.ciphertext,
      tokenNonce: sealedAccess.nonce,
    };
    if (sealedRefresh) {
      config['refreshCiphertext'] = sealedRefresh.ciphertext;
      config['refreshNonce'] = sealedRefresh.nonce;
    }

    const row = await this.prisma.forSystem().integration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: 'GOOGLE_CALENDAR' } },
      create: {
        workspaceId,
        provider: 'GOOGLE_CALENDAR',
        oauthAccountId: oauthAccount.id,
        createdByUserId: actorUserId,
        state: 'CONNECTED',
        config: config as Prisma.InputJsonValue,
      },
      update: {
        oauthAccountId: oauthAccount.id,
        state: 'CONNECTED',
        config: config as Prisma.InputJsonValue,
      },
    });

    return { integrationId: row.id, googleEmail: profile.email };
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`Google token exchange failed (${res.status})`);
      }
      const json = (await res.json()) as GoogleTokenResponse;
      if (!json.access_token) {
        throw new BadRequestException('Google token exchange returned no access_token');
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchProfile(accessToken: string): Promise<GoogleUserInfo> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`Google userinfo fetch failed (${res.status})`);
      }
      return (await res.json()) as GoogleUserInfo;
    } finally {
      clearTimeout(timer);
    }
  }

  private clientId(): string {
    const id = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID', '');
    if (!id) {
      throw new BadRequestException('Google Calendar integration OAuth client is not configured');
    }
    return id;
  }

  private clientSecret(): string {
    const secret = this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET', '');
    if (!secret) {
      throw new BadRequestException('Google Calendar integration OAuth client is not configured');
    }
    return secret;
  }
}
