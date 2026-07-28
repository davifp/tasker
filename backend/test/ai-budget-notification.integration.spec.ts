/**
 * End-to-end wiring test for the AI budget threshold notification bridge.
 *
 * `AiBudgetService.reconcile` emits `workspace-ai-usage.threshold`; the
 * `DomainEventsListener` handler resolves workspace admins and hands off to
 * `NotificationsService.notify`, which persists a `Notification` row (bell)
 * and emits `notification.new` via `RealtimeEmitter`. This test seeds an
 * admin membership, spins up the app, fires a reconcile that crosses the
 * 80% boundary, and asserts the Notification row landed in the DB.
 *
 * We do NOT assert the Socket.IO frame here — the realtime multi-node
 * integration test covers that transport. Bell-row persistence is the
 * user-visible signal this task guarantees.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const TEST_TIMEOUT = 60_000;

describe('AI budget threshold → in-app notification (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let workspaceId: string;
  let adminUserId: string;

  beforeAll(async () => {
    vi.resetModules();
    const [{ AppModule }, { AiBudgetService }, { Test }, { Logger }] = await Promise.all([
      import('../src/app.module'),
      import('../src/ai/budget/ai-budget.service'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();

    const admin = await prisma.user.create({
      data: {
        email: `ai-notif-admin-${Date.now()}@ws.test`,
        displayName: 'Admin',
        updatedAt: new Date(),
      },
    });
    const member = await prisma.user.create({
      data: {
        email: `ai-notif-member-${Date.now()}@ws.test`,
        displayName: 'Member',
        updatedAt: new Date(),
      },
    });
    adminUserId = admin.id;
    const ws = await prisma.workspace.create({
      data: {
        slug: `ai-notif-${Date.now().toString(36)}`,
        name: 'AI Notif WS',
        ownerUserId: admin.id,
        updatedAt: new Date(),
      },
    });
    workspaceId = ws.id;
    await prisma.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId: admin.id,
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId: member.id,
        role: 'MEMBER',
        updatedAt: new Date(),
      },
    });

    // Seed a usage row at 79% so the reconcile below crosses the 80% boundary.
    await prisma.workspaceAiUsage.create({
      data: {
        workspaceId,
        billingMonth: '2026-07',
        tokensBudget: 1000,
        tokensReserved: 100,
        tokensConsumed: 0,
        updatedAt: new Date(),
      },
    });

    // Fire a reconcile that consumes 810 tokens — pushes consumption to 81%.
    const budget = app.get(AiBudgetService, { strict: false });
    await budget.reconcile({ workspaceId, billingMonth: '2026-07', tokens: 100 }, 810);
    // Small settle for the OnEvent handler (event emitter is synchronous but
    // notify() involves a Redis dedupe check).
    await new Promise((r) => setTimeout(r, 200));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  }, TEST_TIMEOUT);

  it('persists an AI_BUDGET_THRESHOLD notification for the admin only', async () => {
    const notifs = await prisma.notification.findMany({
      where: { workspaceId, eventType: 'AI_BUDGET_THRESHOLD' },
    });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].recipientUserId).toBe(adminUserId);
    expect(notifs[0].sourceKind).toBe('WORKSPACE');
    expect(notifs[0].sourceId).toBe(`${workspaceId}:2026-07:80`);
    expect(notifs[0].payload).toEqual(
      expect.objectContaining({ percentage: 80, tokensBudget: 1000, billingMonth: '2026-07' }),
    );
  });

  it('does NOT create an AI_BUDGET_THRESHOLD notification for non-admin members', async () => {
    const memberNotifs = await prisma.notification.findMany({
      where: {
        workspaceId,
        eventType: 'AI_BUDGET_THRESHOLD',
        recipientUserId: { not: adminUserId },
      },
    });
    expect(memberNotifs).toHaveLength(0);
  });
});
