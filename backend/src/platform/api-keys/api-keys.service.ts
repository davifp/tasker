import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiKey, Prisma } from '@prisma/client';
import { API_KEY_SCOPES, type ApiKeyScope } from '@tasker/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyHasher } from './api-key-hasher';

// Bump `lastUsedAt` at most once per minute per key: the guard runs on every
// request but a per-request write would dominate the hot path. One row-write
// per minute of activity is enough for the "last used ~5 min ago" UI copy.
const LAST_USED_MIN_INTERVAL_MS = 60_000;

export interface CreateApiKeyInput {
  workspaceId: string;
  actorUserId: string;
  name: string;
  scopes: readonly ApiKeyScope[];
  expiresAt?: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByUserId: string;
}

export interface CreateApiKeyResult {
  key: ApiKeySummary;
  /** The raw key, shown to the caller **exactly once**. */
  rawKey: string;
}

export interface VerifiedApiKey {
  apiKeyId: string;
  workspaceId: string;
  scopes: ApiKeyScope[];
}

@Injectable()
export class ApiKeysService {
  private readonly defaultPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: ApiKeyHasher,
    config: ConfigService,
  ) {
    this.defaultPrefix = config.get<string>('API_KEY_PREFIX') ?? 'tsk_live';
  }

  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/api-key-expiration-in-past',
        title: 'expiresAt must be in the future',
        status: 400,
      });
    }
    if (!input.scopes.every((scope) => API_KEY_SCOPES.includes(scope))) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/api-key-invalid-scope',
        title: 'Unknown scope',
        status: 400,
      });
    }

    const minted = this.hasher.generate(this.defaultPrefix);
    const row = await this.prisma.forSystem().apiKey.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: input.actorUserId,
        name: input.name,
        keyPrefix: minted.prefix,
        last4: minted.last4,
        keySalt: minted.salt,
        keyHash: minted.hash,
        scopes: [...input.scopes] as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    return { key: this.toSummary(row), rawKey: minted.raw };
  }

  async list(workspaceId: string, options: { includeRevoked?: boolean }): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.forSystem().apiKey.findMany({
      where: {
        workspaceId,
        ...(options.includeRevoked ? {} : { revokedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async revoke(workspaceId: string, apiKeyId: string): Promise<ApiKeySummary> {
    const existing = await this.prisma.forSystem().apiKey.findFirst({
      where: { id: apiKeyId, workspaceId },
    });
    if (!existing) {
      throw new NotFoundException({
        type: 'https://tasker.dev/problems/api-key-not-found',
        title: 'API key not found',
        status: 404,
      });
    }
    if (existing.revokedAt) {
      return this.toSummary(existing);
    }
    const updated = await this.prisma.forSystem().apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });
    return this.toSummary(updated);
  }

  /**
   * Called by the auth guard. Verifies a bearer token against the DB, returns
   * the workspace + scopes if valid, or null if the token isn't an API key,
   * has been revoked, or has expired.
   */
  async verifyRawKey(raw: string): Promise<VerifiedApiKey | null> {
    const parsed = this.hasher.parse(raw);
    if (!parsed) return null;

    // Short-list by (prefix, last4) — indexed lookup, at most a handful of rows.
    const candidates = await this.prisma.forSystem().apiKey.findMany({
      where: { keyPrefix: parsed.prefix, last4: parsed.last4 },
    });
    for (const row of candidates) {
      if (row.revokedAt) continue;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) continue;
      if (!this.hasher.verify(raw, row.keySalt, row.keyHash)) continue;
      this.bumpLastUsed(row).catch(() => {
        // Non-fatal — the auth decision must not depend on this write.
      });
      return {
        apiKeyId: row.id,
        workspaceId: row.workspaceId,
        scopes: this.parseScopes(row.scopes),
      };
    }
    return null;
  }

  private async bumpLastUsed(row: ApiKey): Promise<void> {
    const now = Date.now();
    if (row.lastUsedAt && now - row.lastUsedAt.getTime() < LAST_USED_MIN_INTERVAL_MS) {
      return;
    }
    await this.prisma.forSystem().apiKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(now) },
    });
  }

  private toSummary(row: ApiKey): ApiKeySummary {
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      last4: row.last4,
      scopes: this.parseScopes(row.scopes),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.createdByUserId,
    };
  }

  private parseScopes(value: unknown): ApiKeyScope[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (v): v is ApiKeyScope =>
        typeof v === 'string' && (API_KEY_SCOPES as readonly string[]).includes(v),
    );
  }
}
