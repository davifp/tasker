import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { PreferencesService, defaultPreference } from './preferences.service';

function makePrisma(rows: Array<{ eventType: string; channel: string; enabled: boolean }> = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const findUnique = vi.fn().mockResolvedValue(null);
  const upsert = vi.fn().mockResolvedValue({});
  const $transaction = vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
  const prisma = {
    forSystem: () => ({
      notificationPreference: { findMany, findUnique, upsert },
      $transaction,
    }),
  } as unknown as PrismaService;
  return { prisma, findMany, findUnique, upsert, $transaction };
}

describe('defaultPreference', () => {
  it('mirrors the PRD default matrix', () => {
    expect(defaultPreference('COMMENT_MENTION', 'IN_APP')).toBe(true);
    expect(defaultPreference('COMMENT_MENTION', 'EMAIL')).toBe(true);
    expect(defaultPreference('COMMENT_MENTION', 'PUSH')).toBe(true);
    expect(defaultPreference('TASK_ASSIGNED', 'PUSH')).toBe(true);
    expect(defaultPreference('COMMENT_FOLLOWED', 'IN_APP')).toBe(true);
    expect(defaultPreference('COMMENT_FOLLOWED', 'EMAIL')).toBe(false);
    expect(defaultPreference('COMMENT_FOLLOWED', 'PUSH')).toBe(false);
    expect(defaultPreference('SPRINT_LIFECYCLE', 'IN_APP')).toBe(true);
    expect(defaultPreference('SPRINT_LIFECYCLE', 'EMAIL')).toBe(true);
    expect(defaultPreference('SPRINT_LIFECYCLE', 'PUSH')).toBe(false);
  });
});

describe('PreferencesService.getEffective', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the full default matrix when no rows are stored', async () => {
    const { prisma } = makePrisma();
    const service = new PreferencesService(prisma);
    const result = await service.getEffective('user-a');
    expect(result.COMMENT_MENTION).toEqual({ IN_APP: true, EMAIL: true, PUSH: true });
    expect(result.COMMENT_FOLLOWED).toEqual({ IN_APP: true, EMAIL: false, PUSH: false });
  });

  it('overlays stored rows onto the defaults', async () => {
    const { prisma } = makePrisma([
      { eventType: 'COMMENT_MENTION', channel: 'EMAIL', enabled: false },
    ]);
    const service = new PreferencesService(prisma);
    const result = await service.getEffective('user-a');
    expect(result.COMMENT_MENTION!.EMAIL).toBe(false);
    // Untouched cells stay at default.
    expect(result.COMMENT_MENTION!.IN_APP).toBe(true);
    expect(result.COMMENT_MENTION!.PUSH).toBe(true);
  });
});

describe('PreferencesService.isEnabled', () => {
  it('returns the row when present', async () => {
    const { prisma, findUnique } = makePrisma();
    findUnique.mockResolvedValueOnce({ enabled: false });
    const service = new PreferencesService(prisma);
    await expect(service.isEnabled('user-a', 'COMMENT_MENTION', 'EMAIL')).resolves.toBe(false);
  });

  it('falls back to defaults when no row exists', async () => {
    const { prisma } = makePrisma();
    const service = new PreferencesService(prisma);
    await expect(service.isEnabled('user-a', 'COMMENT_FOLLOWED', 'EMAIL')).resolves.toBe(false);
    await expect(service.isEnabled('user-a', 'COMMENT_MENTION', 'EMAIL')).resolves.toBe(true);
  });
});

describe('PreferencesService.upsertMany', () => {
  it('runs every entry inside a single transaction', async () => {
    const { prisma, upsert, $transaction } = makePrisma();
    const service = new PreferencesService(prisma);
    await service.upsertMany('user-a', [
      { eventType: 'COMMENT_MENTION', channel: 'EMAIL', enabled: false },
      { eventType: 'TASK_ASSIGNED', channel: 'PUSH', enabled: true },
    ]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

describe('PreferencesService.listAll', () => {
  it('emits every (eventType × channel) pair from the defaults', () => {
    const { prisma } = makePrisma();
    const service = new PreferencesService(prisma);
    const all = service.listAll();
    expect(all).toHaveLength(4 * 3);
    const key = (r: { eventType: string; channel: string }) => `${r.eventType}:${r.channel}`;
    const keys = new Set(all.map(key));
    expect(keys.has('COMMENT_MENTION:IN_APP')).toBe(true);
    expect(keys.has('SPRINT_LIFECYCLE:PUSH')).toBe(true);
  });
});
