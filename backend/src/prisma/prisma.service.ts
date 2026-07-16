import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { WorkspaceContextStore } from '../common/context/workspace-context.store';
import { buildTenantExtension } from './tenant.extension';

function createTenantClient(raw: PrismaClient, store: WorkspaceContextStore) {
  return raw.$extends(buildTenantExtension(store));
}

type TenantClient = ReturnType<typeof createTenantClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly raw: PrismaClient;
  private readonly tenant: TenantClient;

  constructor(store: WorkspaceContextStore) {
    this.raw = new PrismaClient();
    this.tenant = createTenantClient(this.raw, store);
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }

  forTenant(): TenantClient {
    return this.tenant;
  }

  // For operations that legitimately span workspaces (e.g. listing a user's memberships).
  // Do not use inside a workspace-scoped request handler.
  forSystem(): PrismaClient {
    return this.raw;
  }

  async ping(): Promise<void> {
    await this.raw.$queryRaw`SELECT 1`;
  }
}
