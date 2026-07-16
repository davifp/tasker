import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OAuthController } from './oauth.controller';
import { OAuthAccountLinker } from './oauth-account-linker.service';
import { OAuthStateService } from './oauth-state.service';
import { GithubOAuthProvider } from './providers/github-oauth.provider';
import { GoogleOAuthProvider } from './providers/google-oauth.provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';

@Module({
  imports: [PrismaModule, SessionsModule],
  controllers: [OAuthController],
  providers: [
    OAuthAccountLinker,
    OAuthStateService,
    GoogleOAuthProvider,
    GithubOAuthProvider,
    OAuthProviderRegistry,
  ],
})
export class OAuthModule {}
