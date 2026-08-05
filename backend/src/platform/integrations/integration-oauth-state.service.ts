import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import type { IntegrationProviderName } from '@tasker/config';

interface StoredIntegrationState {
  provider: IntegrationProviderName;
  workspaceId: string;
  userId: string;
  returnTo?: string;
}

/**
 * Separate namespace from `OAuthStateService` so the integration-connect flow
 * cannot collide with the sign-in flow (they issue distinct authorize
 * requests and land on distinct callback routes). Single-use via GETDEL —
 * even a leaked state token can only be redeemed once.
 */
@Injectable()
export class IntegrationOAuthStateService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('OAUTH_STATE_TTL_S', 600);
  }

  async issue(
    provider: IntegrationProviderName,
    workspaceId: string,
    userId: string,
    returnTo?: string,
  ): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const payload: StoredIntegrationState = { provider, workspaceId, userId, returnTo };
    await this.redis.set(this.key(state), JSON.stringify(payload), 'EX', this.ttlSeconds);
    return state;
  }

  async consume(
    state: string,
    expectedProvider: IntegrationProviderName,
  ): Promise<StoredIntegrationState> {
    if (!state) {
      throw new BadRequestException('Missing integration state parameter');
    }
    const raw = await this.redis.getdel(this.key(state));
    if (!raw) {
      throw new BadRequestException('Integration state is missing or expired');
    }
    const parsed = JSON.parse(raw) as StoredIntegrationState;
    if (parsed.provider !== expectedProvider) {
      throw new BadRequestException('Integration state provider mismatch');
    }
    return parsed;
  }

  private key(state: string): string {
    return `integration:oauth:state:${state}`;
  }
}
