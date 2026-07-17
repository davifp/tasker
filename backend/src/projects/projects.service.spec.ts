import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectEvents } from './events/project.events';

const WORKSPACE_ID = 'ws-1';
const ACTOR_USER_ID = 'user-1';
const PROJECT_ID = 'proj-1';

const projectClient = {
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
};

const rawClient = { project: projectClient };

const mockPrisma = { forSystem: vi.fn(() => rawClient) };
const emit = vi.fn();

async function buildService(): Promise<ProjectsService> {
  const module = await Test.createTestingModule({
    providers: [
      ProjectsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: { emit } },
    ],
  }).compile();
  return module.get(ProjectsService);
}

function makeUniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// create — slug retry
// ---------------------------------------------------------------------------

describe('ProjectsService.create', () => {
  it('creates a project with owner+creator captured from the actor and emits CREATED', async () => {
    const service = await buildService();
    projectClient.create.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      slug: 'web',
      name: 'Web',
      ownerUserId: ACTOR_USER_ID,
      createdByUserId: ACTOR_USER_ID,
    });

    const project = await service.create({
      name: 'Web',
      slug: 'web',
      color: '#3b82f6',
      icon: 'Package',
      workspaceId: WORKSPACE_ID,
      actorUserId: ACTOR_USER_ID,
    });

    expect(project.id).toBe(PROJECT_ID);
    expect(projectClient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        slug: 'web',
        ownerUserId: ACTOR_USER_ID,
        createdByUserId: ACTOR_USER_ID,
      }),
    });
    expect(emit).toHaveBeenCalledWith(
      ProjectEvents.CREATED,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
        slug: 'web',
      }),
    );
  });

  it('retries with a numeric suffix on slug collision', async () => {
    const service = await buildService();
    projectClient.create
      .mockRejectedValueOnce(makeUniqueViolation(['workspaceId', 'slug']))
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        slug: 'web-2',
        ownerUserId: ACTOR_USER_ID,
        createdByUserId: ACTOR_USER_ID,
      });

    const project = await service.create({
      name: 'Web',
      slug: 'web',
      color: '#3b82f6',
      icon: 'Package',
      workspaceId: WORKSPACE_ID,
      actorUserId: ACTOR_USER_ID,
    });

    expect(project.slug).toBe('web-2');
    expect(projectClient.create).toHaveBeenCalledTimes(2);
    expect((projectClient.create.mock.calls[1][0] as { data: { slug: string } }).data.slug).toBe(
      'web-2',
    );
  });

  it('throws ConflictException when all retry candidates are taken', async () => {
    const service = await buildService();
    projectClient.create.mockRejectedValue(makeUniqueViolation(['workspaceId', 'slug']));

    await expect(
      service.create({
        name: 'Web',
        slug: 'web',
        color: '#3b82f6',
        icon: 'Package',
        workspaceId: WORKSPACE_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(projectClient.create).toHaveBeenCalledTimes(3);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rethrows non-uniqueness Prisma errors', async () => {
    const service = await buildService();
    const otherErr = new Prisma.PrismaClientKnownRequestError('fk error', {
      code: 'P2003',
      clientVersion: 'test',
    });
    projectClient.create.mockRejectedValueOnce(otherErr);

    await expect(
      service.create({
        name: 'Web',
        slug: 'web',
        color: '#3b82f6',
        icon: 'Package',
        workspaceId: WORKSPACE_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBe(otherErr);
  });
});

// ---------------------------------------------------------------------------
// findBySlug
// ---------------------------------------------------------------------------

describe('ProjectsService.findBySlug', () => {
  it('returns the project when found and not deleted', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      slug: 'web',
      deletedAt: null,
    });

    const found = await service.findBySlug(WORKSPACE_ID, 'web');
    expect(found?.id).toBe(PROJECT_ID);
    expect(projectClient.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_slug: { workspaceId: WORKSPACE_ID, slug: 'web' } },
    });
  });

  it('returns null for a soft-deleted project by default', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      slug: 'web',
      deletedAt: new Date(),
    });

    const found = await service.findBySlug(WORKSPACE_ID, 'web');
    expect(found).toBeNull();
  });

  it('returns a soft-deleted project when includeDeleted=true', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      slug: 'web',
      deletedAt: new Date(),
    });

    const found = await service.findBySlug(WORKSPACE_ID, 'web', true);
    expect(found?.id).toBe(PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// softDelete + restore
// ---------------------------------------------------------------------------

describe('ProjectsService.softDelete + restore', () => {
  it('sets deletedAt and purgeAt ≈ 30 days ahead and emits DELETED', async () => {
    const service = await buildService();
    const before = Date.now();
    projectClient.update.mockImplementation(async ({ data }) => ({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: data.deletedAt,
      purgeAt: data.purgeAt,
    }));

    const deleted = await service.softDelete({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorUserId: ACTOR_USER_ID,
    });
    const after = Date.now();

    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.purgeAt).toBeInstanceOf(Date);
    const purgeMs = (deleted.purgeAt as Date).getTime();
    // 30 days ≈ 2,592,000,000 ms — allow before/after window drift
    expect(purgeMs - before).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
    expect(purgeMs - after).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    expect(emit).toHaveBeenCalledWith(
      ProjectEvents.DELETED,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    );
  });

  it('restore clears deletedAt/purgeAt and emits RESTORED', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: new Date(),
      purgeAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    projectClient.update.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: null,
      purgeAt: null,
    });

    const restored = await service.restore({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorUserId: ACTOR_USER_ID,
    });

    expect(restored.deletedAt).toBeNull();
    expect(restored.purgeAt).toBeNull();
    expect(emit).toHaveBeenCalledWith(
      ProjectEvents.RESTORED,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    );
  });

  it('restore throws NotFoundException when the project does not exist', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.restore({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(projectClient.update).not.toHaveBeenCalled();
  });

  it('restore throws BadRequestException when the project is not deleted', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: null,
      purgeAt: null,
    });

    await expect(
      service.restore({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restore throws BadRequestException when the purge window has elapsed', async () => {
    const service = await buildService();
    projectClient.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      purgeAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    await expect(
      service.restore({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// list — cursor pagination + soft-delete filtering
// ---------------------------------------------------------------------------

describe('ProjectsService.list', () => {
  it('excludes soft-deleted projects by default', async () => {
    const service = await buildService();
    projectClient.findMany.mockResolvedValueOnce([]);

    await service.list(WORKSPACE_ID);
    expect(projectClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          deletedAt: null,
        }),
      }),
    );
  });

  it('includes soft-deleted when includeDeleted=true', async () => {
    const service = await buildService();
    projectClient.findMany.mockResolvedValueOnce([]);

    await service.list(WORKSPACE_ID, { includeDeleted: true });
    const call = projectClient.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.deletedAt).toBeUndefined();
  });

  it('returns nextCursor when the page is full', async () => {
    const service = await buildService();
    const items = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}` }));
    projectClient.findMany.mockResolvedValueOnce(items);

    const page = await service.list(WORKSPACE_ID, { limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe('p9');
  });

  it('returns nextCursor=null when the page is short', async () => {
    const service = await buildService();
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }));
    projectClient.findMany.mockResolvedValueOnce(items);

    const page = await service.list(WORKSPACE_ID, { limit: 10 });
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('clamps limit to the 1–100 range', async () => {
    const service = await buildService();
    projectClient.findMany.mockResolvedValueOnce([]);
    await service.list(WORKSPACE_ID, { limit: 999 });
    expect(projectClient.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));

    projectClient.findMany.mockResolvedValueOnce([]);
    await service.list(WORKSPACE_ID, { limit: 0 });
    expect(projectClient.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });
});
