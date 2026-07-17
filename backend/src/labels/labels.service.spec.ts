import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LabelsService } from './labels.service';
import { PrismaService } from '../prisma/prisma.service';

const WORKSPACE_ID = 'ws-1';
const LABEL_ID = 'label-1';

const labelClient = {
  create: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const rawClient = { label: labelClient };
const mockPrisma = { forSystem: vi.fn(() => rawClient) };

async function buildService(): Promise<LabelsService> {
  const module = await Test.createTestingModule({
    providers: [LabelsService, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
  return module.get(LabelsService);
}

function makeUniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function makeNotFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LabelsService.create', () => {
  it('trims the name before persisting', async () => {
    const service = await buildService();
    labelClient.create.mockResolvedValueOnce({
      id: LABEL_ID,
      workspaceId: WORKSPACE_ID,
      name: 'bug',
      color: '#ef4444',
    });

    await service.create({ name: '  bug  ', color: '#ef4444', workspaceId: WORKSPACE_ID });
    expect(labelClient.create).toHaveBeenCalledWith({
      data: { workspaceId: WORKSPACE_ID, name: 'bug', color: '#ef4444' },
    });
  });

  it('throws 409 label-name-taken on duplicate', async () => {
    const service = await buildService();
    labelClient.create.mockRejectedValueOnce(makeUniqueViolation(['workspaceId', 'name']));

    try {
      await service.create({ name: 'bug', color: '#ef4444', workspaceId: WORKSPACE_ID });
      expect.fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as { type: string; status: number };
      expect(response.type).toBe('https://tasker.dev/problems/label-name-taken');
      expect(response.status).toBe(409);
    }
  });

  it('rethrows non-uniqueness Prisma errors', async () => {
    const service = await buildService();
    const other = new Prisma.PrismaClientKnownRequestError('fk error', {
      code: 'P2003',
      clientVersion: 'test',
    });
    labelClient.create.mockRejectedValueOnce(other);
    await expect(
      service.create({ name: 'bug', color: '#ef4444', workspaceId: WORKSPACE_ID }),
    ).rejects.toBe(other);
  });
});

describe('LabelsService.list', () => {
  it('returns nextCursor when the page is full', async () => {
    const service = await buildService();
    const items = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}` }));
    labelClient.findMany.mockResolvedValueOnce(items);

    const page = await service.list(WORKSPACE_ID, { limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe('l9');
  });

  it('returns nextCursor=null when the page is short', async () => {
    const service = await buildService();
    labelClient.findMany.mockResolvedValueOnce([{ id: 'l0' }, { id: 'l1' }]);
    const page = await service.list(WORKSPACE_ID, { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('scopes findMany to the workspace', async () => {
    const service = await buildService();
    labelClient.findMany.mockResolvedValueOnce([]);
    await service.list(WORKSPACE_ID);
    expect(labelClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
    );
  });
});

describe('LabelsService.update', () => {
  it('trims the name before persisting', async () => {
    const service = await buildService();
    labelClient.update.mockResolvedValueOnce({ id: LABEL_ID, name: 'bug', color: '#ef4444' });
    await service.update(WORKSPACE_ID, LABEL_ID, { name: '  bug  ' });
    expect(labelClient.update).toHaveBeenCalledWith({
      where: { id: LABEL_ID, workspaceId: WORKSPACE_ID },
      data: { name: 'bug' },
    });
  });

  it('throws 409 label-name-taken on rename collision', async () => {
    const service = await buildService();
    labelClient.update.mockRejectedValueOnce(makeUniqueViolation(['workspaceId', 'name']));
    await expect(service.update(WORKSPACE_ID, LABEL_ID, { name: 'bug' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFoundException when the label does not exist', async () => {
    const service = await buildService();
    labelClient.update.mockRejectedValueOnce(makeNotFound());
    await expect(
      service.update(WORKSPACE_ID, LABEL_ID, { color: '#000000' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LabelsService.delete', () => {
  it('hard-deletes the label', async () => {
    const service = await buildService();
    labelClient.delete.mockResolvedValueOnce({});
    await service.delete(WORKSPACE_ID, LABEL_ID);
    expect(labelClient.delete).toHaveBeenCalledWith({
      where: { id: LABEL_ID, workspaceId: WORKSPACE_ID },
    });
  });

  it('throws NotFoundException when the label does not exist', async () => {
    const service = await buildService();
    labelClient.delete.mockRejectedValueOnce(makeNotFound());
    await expect(service.delete(WORKSPACE_ID, LABEL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
