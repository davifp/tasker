import { Injectable, NotFoundException } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import { GithubOAuthProvider } from './github-oauth.provider';
import { GoogleOAuthProvider } from './google-oauth.provider';
import { OAuthProviderClient } from './oauth-provider.interface';

@Injectable()
export class OAuthProviderRegistry {
  private readonly clients: Map<OAuthProvider, OAuthProviderClient>;

  constructor(google: GoogleOAuthProvider, github: GithubOAuthProvider) {
    this.clients = new Map<OAuthProvider, OAuthProviderClient>([
      [google.provider, google],
      [github.provider, github],
    ]);
  }

  resolve(slug: string): OAuthProviderClient {
    const provider = slug.toUpperCase() as OAuthProvider;
    const client = this.clients.get(provider);
    if (!client) {
      throw new NotFoundException(`Unknown OAuth provider: ${slug}`);
    }
    return client;
  }
}
