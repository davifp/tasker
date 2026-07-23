import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { MentionsService, slugifyDisplayName } from './mentions.service';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('slugifyDisplayName', () => {
  it('lowercases', () => {
    expect(slugifyDisplayName('Ana Silva')).toBe('ana-silva');
  });
  it('collapses non-handle chars to a single dash', () => {
    expect(slugifyDisplayName('Bob   O\'Neil!')).toBe('bob-o-neil');
  });
  it('preserves dots and underscores', () => {
    expect(slugifyDisplayName('dev_ops.Team')).toBe('dev_ops.team');
  });
  it('trims leading/trailing separators', () => {
    expect(slugifyDisplayName('.hidden-name-')).toBe('hidden-name');
  });
});

function makeTx(members: Array<{ userId: string; displayName: string }>): Prisma.TransactionClient {
  const rows = members.map((m, i) => ({
    user: { id: m.userId, displayName: m.displayName },
    joinedAt: new Date(2020, 0, i + 1),
  }));
  const findMany = vi.fn().mockResolvedValue(rows);
  return { workspaceMember: { findMany } } as unknown as Prisma.TransactionClient;
}

describe('MentionsService.resolve', () => {
  const svc = new MentionsService({} as unknown as PrismaService);

  it('resolves a matching handle to the workspace member', async () => {
    const tx = makeTx([
      { userId: 'u-ana', displayName: 'Ana Silva' },
      { userId: 'u-bob', displayName: 'Bob' },
    ]);
    const out = await svc.resolve(tx, 'ws-1', [{ handle: 'ana-silva', offset: 0 }]);
    expect(out).toEqual([
      { userId: 'u-ana', displayName: 'Ana Silva', handle: 'ana-silva', offset: 0 },
    ]);
  });

  it('drops handles that match no member (soft failure per PRD FR-12)', async () => {
    const tx = makeTx([{ userId: 'u-ana', displayName: 'Ana' }]);
    const out = await svc.resolve(tx, 'ws-1', [{ handle: 'ghost', offset: 0 }]);
    expect(out).toEqual([]);
  });

  it('resolves case-insensitively', async () => {
    const tx = makeTx([{ userId: 'u-ana', displayName: 'Ana' }]);
    const out = await svc.resolve(tx, 'ws-1', [{ handle: 'ANA', offset: 5 }]);
    expect(out.map(r => r.userId)).toEqual(['u-ana']);
  });

  it('does not double-resolve the same user for duplicate candidates', async () => {
    const tx = makeTx([{ userId: 'u-ana', displayName: 'Ana' }]);
    const out = await svc.resolve(tx, 'ws-1', [
      { handle: 'ana', offset: 0 },
      { handle: 'Ana', offset: 10 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns [] for no candidates without hitting the DB', async () => {
    const tx = makeTx([]);
    const out = await svc.resolve(tx, 'ws-1', []);
    expect(out).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((tx as any).workspaceMember.findMany as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('prefers the earliest-joined member when two share a slug', async () => {
    const tx = makeTx([
      { userId: 'u-1', displayName: 'Bob' },
      { userId: 'u-2', displayName: 'BOB' },
    ]);
    const out = await svc.resolve(tx, 'ws-1', [{ handle: 'bob', offset: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.userId).toBe('u-1');
  });
});
