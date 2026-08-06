import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { WorkspaceContextStore } from '../common/context/workspace-context.store';
import { buildTenantExtension } from './tenant.extension';
import { buildDemoReadOnlyExtension } from './demo-readonly.extension';

function withDemoGuard(raw: PrismaClient, store: WorkspaceContextStore) {
  return raw.$extends(buildDemoReadOnlyExtension(store));
}

function createTenantClient(raw: PrismaClient, store: WorkspaceContextStore) {
  // Extensions stack left-to-right: the demo-read-only guard runs first (so a
  // demo-account write is rejected before tenant scoping touches it), then
  // tenant isolation injects `workspaceId` on the remaining reads.
  return withDemoGuard(raw, store).$extends(buildTenantExtension(store));
}

type TenantClient = ReturnType<typeof createTenantClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly raw: PrismaClient;
  private readonly tenant: TenantClient;
  private readonly system: PrismaClient;

  constructor(store: WorkspaceContextStore) {
    this.raw = new PrismaClient();
    // Both entry points carry the demo-read-only guard so a mutation slipping
    // through `.forSystem()` (invitation accept, /me/*, notifications, ai) is
    // still rejected at the persistence layer when the CLS role or the
    // request-scoped `isDemo` bit has been set. The system client is typed
    // as `PrismaClient` (not the extended-client type) so callers that thread
    // it through `$transaction(async (tx) => ...)` or narrow the surface
    // don't need to update every signature — the extension is a runtime
    // interceptor and preserves the exposed API.
    this.system = withDemoGuard(this.raw, store) as unknown as PrismaClient;
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

  // For operations that legitimately span workspaces (e.g. listing a user's
  // memberships, accepting an invitation before membership exists). The
  // demo-read-only extension still applies — only tenant isolation is
  // skipped.
  forSystem(): PrismaClient {
    return this.system;
  }

  async ping(): Promise<void> {
    await this.raw.$queryRaw`SELECT 1`;
  }
}
