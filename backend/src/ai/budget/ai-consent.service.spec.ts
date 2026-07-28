import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiConsentService } from './ai-consent.service';

function makePrisma(row?: {
  workspaceId: string;
  acceptedByUserId: string;
  documentVersion: string;
  acceptedAt: Date;
}) {
  const upsert = vi.fn().mockResolvedValue(row ?? {});
  const findUnique = vi.fn().mockResolvedValue(row ?? null);
  return {
    upsert,
    findUnique,
    prisma: {
      forSystem: () => ({
        workspaceAiConsent: { upsert, findUnique },
      }),
    },
  };
}

function makeConfig(version = 'v1'): ConfigService {
  return {
    get: (key: string) => (key === 'AI_CONSENT_DOCUMENT_VERSION' ? version : undefined),
  } as unknown as ConfigService;
}

describe('AiConsentService', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('accept() upserts with the required document version by default', async () => {
    const svc = new AiConsentService(prisma.prisma as never, makeConfig('v2'));
    await svc.accept('ws-1', 'user-1');
    expect(prisma.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        create: expect.objectContaining({
          workspaceId: 'ws-1',
          acceptedByUserId: 'user-1',
          documentVersion: 'v2',
        }),
      }),
    );
  });

  it('getStatus() returns accepted=false when no row exists', async () => {
    prisma = makePrisma();
    const svc = new AiConsentService(prisma.prisma as never, makeConfig('v1'));
    const status = await svc.getStatus('ws-1');
    expect(status).toEqual({ accepted: false, requiredDocumentVersion: 'v1' });
  });

  it('getStatus() returns accepted=true when documentVersion matches', async () => {
    prisma = makePrisma({
      workspaceId: 'ws-1',
      acceptedByUserId: 'user-1',
      documentVersion: 'v1',
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
    });
    const svc = new AiConsentService(prisma.prisma as never, makeConfig('v1'));
    const status = await svc.getStatus('ws-1');
    expect(status.accepted).toBe(true);
    expect(status.acceptedDocumentVersion).toBe('v1');
    expect(status.requiredDocumentVersion).toBe('v1');
  });

  it('getStatus() returns accepted=false when the stored version is stale', async () => {
    prisma = makePrisma({
      workspaceId: 'ws-1',
      acceptedByUserId: 'user-1',
      documentVersion: 'v1',
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
    });
    const svc = new AiConsentService(prisma.prisma as never, makeConfig('v2'));
    const status = await svc.getStatus('ws-1');
    expect(status.accepted).toBe(false);
    expect(status.acceptedDocumentVersion).toBe('v1');
    expect(status.requiredDocumentVersion).toBe('v2');
  });

  it('isCurrentlyAccepted() delegates to getStatus().accepted', async () => {
    prisma = makePrisma({
      workspaceId: 'ws-1',
      acceptedByUserId: 'user-1',
      documentVersion: 'v1',
      acceptedAt: new Date(),
    });
    const svc = new AiConsentService(prisma.prisma as never, makeConfig('v1'));
    await expect(svc.isCurrentlyAccepted('ws-1')).resolves.toBe(true);

    const staleSvc = new AiConsentService(prisma.prisma as never, makeConfig('v2'));
    await expect(staleSvc.isCurrentlyAccepted('ws-1')).resolves.toBe(false);
  });
});
