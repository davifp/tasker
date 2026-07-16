import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SessionsService } from '../sessions/sessions.service';
import { TokenService } from '../common/security/token.service';
import { OAuthAccountLinker } from './oauth-account-linker.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';

function resolveDevice(req: Request) {
  return {
    deviceLabel: (req.headers['user-agent'] as string | undefined) ?? 'oauth-client',
    userAgent: req.headers['user-agent'] as string | undefined,
    ip: req.ip,
  };
}

@Controller('auth/oauth')
@Public()
@SkipThrottle({
  default: true,
  register: true,
  login: true,
  refresh: true,
  emailResend: true,
  passwordReset: true,
})
export class OAuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: OAuthProviderRegistry,
    private readonly state: OAuthStateService,
    private readonly linker: OAuthAccountLinker,
    private readonly sessions: SessionsService,
    private readonly tokenService: TokenService,
  ) {}

  @Get(':provider')
  async initiate(@Param('provider') providerSlug: string, @Res() res: Response): Promise<void> {
    const client = this.registry.resolve(providerSlug);
    const state = await this.state.issue(client.provider);
    const url = client.buildAuthorizeUrl({
      state,
      redirectUri: this.callbackUri(providerSlug),
    });
    res.redirect(302, url);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') providerSlug: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const client = this.registry.resolve(providerSlug);

    // Consume state first so a missing code doesn't leave orphan state records.
    await this.state.consume(state ?? '', client.provider);

    if (!code) {
      throw new BadRequestException('Missing OAuth authorization code');
    }

    const profile = await client.fetchProfile({
      code,
      redirectUri: this.callbackUri(providerSlug),
    });
    const user = await this.linker.resolveOAuthLogin(profile);
    const { session, refresh } = await this.sessions.create(user.id, resolveDevice(req));
    const access = this.tokenService.signAccess({ sub: user.id, sid: session.id });

    const successUrl = this.config.getOrThrow<string>('OAUTH_SUCCESS_REDIRECT_URL');
    // Use the URL fragment so tokens don't leak into server logs of the frontend.
    const target = `${successUrl}#accessToken=${encodeURIComponent(access)}&refreshToken=${encodeURIComponent(refresh)}`;
    res.redirect(302, target);
  }

  private callbackUri(providerSlug: string): string {
    const base = this.config.getOrThrow<string>('OAUTH_CALLBACK_BASE_URL');
    return `${base}/api/v1/auth/oauth/${providerSlug}/callback`;
  }
}
