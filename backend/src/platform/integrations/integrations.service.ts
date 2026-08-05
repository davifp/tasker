import { Injectable } from '@nestjs/common';
import type { Integration, IntegrationProvider, IntegrationState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface IntegrationSummary {
  id: string;
  provider: IntegrationProvider;
  state: IntegrationState;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  // config surfaces only known-safe fields — access tokens are never serialised.
  config: Record<string, unknown>;
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string): Promise<IntegrationSummary[]> {
    const rows = await this.prisma.forSystem().integration.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async findByProvider(
    workspaceId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationSummary | null> {
    const row = await this.prisma.forSystem().integration.findFirst({
      where: { workspaceId, provider },
    });
    return row ? this.toSummary(row) : null;
  }

  private toSummary(row: Integration): IntegrationSummary {
    const raw = (row.config ?? {}) as Record<string, unknown>;
    // Strip token material so /integrations never leaks the sealed token bytes.
    const {
      tokenCiphertext: _t,
      tokenNonce: _n,
      refreshCiphertext: _r,
      refreshNonce: _rn,
      ...safe
    } = raw as Record<string, unknown>;
    void _t;
    void _n;
    void _r;
    void _rn;
    return {
      id: row.id,
      provider: row.provider,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdByUserId: row.createdByUserId,
      config: safe,
    };
  }
}
