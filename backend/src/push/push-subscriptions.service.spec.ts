import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

function makePrisma() {
  const upsert = vi.fn().mockResolvedValue({ id: 's-1' });
  const findMany = vi.fn().mockResolvedValue([]);
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    forSystem: () => ({
      pushSubscription: { upsert, findMany, deleteMany, update },
    }),
  } as unknown as PrismaService;
  return { prisma, upsert, findMany, deleteMany, update };
}

describe('PushSubscriptionsService.upsert', () => {
  it('creates or updates by endpoint and stores keys', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new PushSubscriptionsService(prisma);
    await service.upsert('user-a', {
      endpoint: 'https://push.example/e',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: 'chrome',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      where: { endpoint: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ endpoint: 'https://push.example/e' });
    expect(arg.create).toMatchObject({
      userId: 'user-a',
      endpoint: 'https://push.example/e',
      p256dh: 'p',
      authKey: 'a',
      userAgent: 'chrome',
    });
    expect(arg.update).toMatchObject({ userId: 'user-a', p256dh: 'p', authKey: 'a' });
  });
});

describe('PushSubscriptionsService.deleteByEndpoint', () => {
  it('scopes deletion to the user when a userId is provided', async () => {
    const { prisma, deleteMany } = makePrisma();
    deleteMany.mockResolvedValueOnce({ count: 1 });
    const service = new PushSubscriptionsService(prisma);
    const result = await service.deleteByEndpoint('https://push.example/e', 'user-a');
    expect(deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/e', userId: 'user-a' },
    });
    expect(result).toEqual({ deleted: 1 });
  });

  it('runs unfiltered when called from the push channel (no userId)', async () => {
    const { prisma, deleteMany } = makePrisma();
    const service = new PushSubscriptionsService(prisma);
    await service.deleteByEndpoint('https://push.example/e');
    expect(deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'https://push.example/e' } });
  });
});
