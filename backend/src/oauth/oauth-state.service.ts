import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { OAuthProvider } from '@prisma/client';

interface StoredState {
  provider: OAuthProvider;
}

@Injectable()
export class OAuthStateService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('OAUTH_STATE_TTL_S', 600);
  }

  // Issues a fresh state token, persists provider metadata under it in Redis,
  // and returns the raw state for use in the authorize redirect. Single-use:
  // consume() deletes the record atomically on the callback side.
  async issue(provider: OAuthProvider): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const payload: StoredState = { provider };
    await this.redis.set(this.key(state), JSON.stringify(payload), 'EX', this.ttlSeconds);
    return state;
  }

  // Verifies that the state exists and was issued for the given provider,
  // consuming it atomically (GETDEL). Throws 400 on missing/expired/mismatch.
  async consume(state: string, expectedProvider: OAuthProvider): Promise<void> {
    if (!state) {
      throw new BadRequestException('Missing OAuth state parameter');
    }
    const raw = await this.redis.getdel(this.key(state));
    if (!raw) {
      throw new BadRequestException('OAuth state is missing or expired');
    }
    const parsed = JSON.parse(raw) as StoredState;
    if (parsed.provider !== expectedProvider) {
      throw new BadRequestException('OAuth state provider mismatch');
    }
  }

  private key(state: string): string {
    return `oauth:state:${state}`;
  }
}
