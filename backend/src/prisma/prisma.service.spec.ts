import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Mock @prisma/client before any imports that transitively depend on it.
// vi.hoisted() ensures the mock object is available when vi.mock() runs.
// ---------------------------------------------------------------------------
const mockRaw = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $extends: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockRaw),
  Prisma: {
    // Minimal DMMF stub: one tenant model and one non-tenant model.
    dmmf: {
      datamodel: {
        models: [
          { name: 'WorkspaceMember', fields: [{ name: 'workspaceId' }] },
          { name: 'User', fields: [{ name: 'email' }] },
        ],
      },
    },
    // In Prisma's real implementation defineExtension returns its argument.
    defineExtension: (ext: unknown) => ext,
  },
}));

import { WorkspaceContextStore } from '../common/context/workspace-context.store';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // $extends must return something (the tenant client); use mockRaw itself.
    mockRaw.$extends.mockReturnValue(mockRaw);

    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, WorkspaceContextStore],
    }).compile();

    service = moduleRef.get(PrismaService);
  });

  describe('construction', () => {
    it('stacks demo-read-only on the system client and (demo-read-only + tenant) on the tenant client', () => {
      // Three $extends calls total:
      //   1. system client = raw + demo-read-only
      //   2. tenant client = raw + demo-read-only + tenant-isolation
      // demo-read-only is applied to BOTH so mutations through `forSystem()`
      // (invitation accept, /me/*, notifications, ai) are still rejected at
      // the persistence layer.
      expect(mockRaw.$extends).toHaveBeenCalledTimes(3);
    });
  });

  describe('onModuleInit()', () => {
    it('connects the underlying PrismaClient', async () => {
      await service.onModuleInit();
      expect(mockRaw.$connect).toHaveBeenCalledOnce();
    });
  });

  describe('onModuleDestroy()', () => {
    it('disconnects the underlying PrismaClient', async () => {
      await service.onModuleDestroy();
      expect(mockRaw.$disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('forTenant()', () => {
    it('returns the extended client (not the raw client)', () => {
      const tenant = service.forTenant();
      expect(tenant).toBeDefined();
      // The extended client is the value returned by $extends.
      expect(tenant).toBe(mockRaw.$extends.mock.results[0].value);
    });
  });

  describe('ping()', () => {
    it('executes a raw SELECT 1 on the underlying client', async () => {
      await service.ping();
      expect(mockRaw.$queryRaw).toHaveBeenCalledOnce();
    });

    it('propagates errors from $queryRaw', async () => {
      mockRaw.$queryRaw.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.ping()).rejects.toThrow('connection lost');
    });
  });
});
