import { OAuthProvider } from '@prisma/client';
import { OAuthProfile } from '../oauth-account-linker.service';

export interface OAuthProviderClient {
  readonly provider: OAuthProvider;

  // Build the provider's authorize URL with client_id, redirect_uri, scope,
  // response_type=code, and the caller-supplied state.
  buildAuthorizeUrl(input: { state: string; redirectUri: string }): string;

  // Exchange an authorization code for an access token, then fetch the user
  // profile and normalize it into the OAuthProfile shape consumed by the linker.
  fetchProfile(input: { code: string; redirectUri: string }): Promise<OAuthProfile>;
}
