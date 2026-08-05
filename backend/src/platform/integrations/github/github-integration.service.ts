import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationTokenVault } from '../integration-token-vault';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
// `repo` grants private repo access; when only public sync is needed the caller
// can override via a future opt-in flag. `read:user` unlocks `/user` for the
// login capture. Requested at connect time and surfaced in the admin consent
// copy so an admin sees exactly what the token is for.
const GITHUB_SCOPES = 'repo read:user';

interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GithubUser {
  id: number;
  login: string;
}

export interface GithubConnectResult {
  integrationId: string;
  githubLogin: string;
}

@Injectable()
export class GithubIntegrationService {
  private readonly logger = new Logger(GithubIntegrationService.name);
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
      scope: GITHUB_SCOPES,
      state,
      allow_signup: 'false',
    });
    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }

  scopesForConsentCopy(): readonly string[] {
    return GITHUB_SCOPES.split(' ');
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
  }): Promise<GithubConnectResult> {
    const token = await this.exchangeCode(code, redirectUri);
    const user = await this.fetchLogin(token.access_token);

    // Ensure an OAuthAccount row exists so the FK on Integration is satisfied
    // — this may be a fresh integration account distinct from the sign-in
    // account (an admin may have signed in via Google but wants a GitHub
    // integration for the workspace).
    const oauthAccount = await this.prisma.forSystem().oAuthAccount.upsert({
      where: {
        provider_providerAccountId: { provider: 'GITHUB', providerAccountId: String(user.id) },
      },
      create: {
        userId: actorUserId,
        provider: 'GITHUB',
        providerAccountId: String(user.id),
      },
      update: {},
    });

    const sealed = this.vault.seal(token.access_token);

    const row = await this.prisma.forSystem().integration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: 'GITHUB' } },
      create: {
        workspaceId,
        provider: 'GITHUB',
        oauthAccountId: oauthAccount.id,
        createdByUserId: actorUserId,
        state: 'CONNECTED',
        config: {
          githubLogin: user.login,
          scopes: token.scope,
          tokenCiphertext: sealed.ciphertext,
          tokenNonce: sealed.nonce,
        },
      },
      update: {
        oauthAccountId: oauthAccount.id,
        state: 'CONNECTED',
        config: {
          githubLogin: user.login,
          scopes: token.scope,
          tokenCiphertext: sealed.ciphertext,
          tokenNonce: sealed.nonce,
        },
      },
    });

    return { integrationId: row.id, githubLogin: user.login };
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<GithubTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: redirectUri,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`GitHub token exchange failed (${res.status})`);
      }
      const json = (await res.json()) as GithubTokenResponse;
      if (!json.access_token) {
        throw new BadRequestException('GitHub token exchange returned no access_token');
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchLogin(accessToken: string): Promise<GithubUser> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(GITHUB_USER_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`GitHub user fetch failed (${res.status})`);
      }
      return (await res.json()) as GithubUser;
    } finally {
      clearTimeout(timer);
    }
  }

  private clientId(): string {
    const id = this.config.get<string>('GITHUB_OAUTH_CLIENT_ID', '');
    if (!id) {
      throw new BadRequestException('GitHub integration OAuth client is not configured');
    }
    return id;
  }

  private clientSecret(): string {
    const secret = this.config.get<string>('GITHUB_OAUTH_CLIENT_SECRET', '');
    if (!secret) {
      throw new BadRequestException('GitHub integration OAuth client is not configured');
    }
    return secret;
  }
}
