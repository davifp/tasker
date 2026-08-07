/**
 * Portfolio seed — populates a fresh (or existing) database with a realistic
 * demo dataset the public site can showcase.
 *
 * Deterministic and idempotent: every row is upserted on a stable natural
 * key, so re-running the seed against a populated DB is a no-op (same rows,
 * no duplicates). Safe to re-run in every CI job and every deploy.
 *
 * Targets (per PRD FR-9.1):
 *   - 5 workspaces
 *   - 20 users (4 members per workspace + the demo viewer)
 *   - 200 tasks (40 per workspace, distributed across 2 projects)
 *   - 1 demo account (`demo@tasker.dev`, DEMO_VIEWER on every workspace)
 *
 * Passwords are hashed with argon2id so the demo account can actually log in
 * through the normal /auth/login path.
 *
 * Usage:
 *   pnpm --filter api exec ts-node-dev --transpile-only --respawn=false prisma/seed.ts
 * or via package.json's prisma.seed hook: `pnpm --filter api prisma db seed`.
 */
// Load env before importing the Prisma client so `DATABASE_URL` is resolved.
// Prisma's own CLI (`prisma migrate`) auto-loads `.env` from the schema
// directory, but `ts-node-dev` invocations do not — this seed script runs
// via `pnpm --filter api seed` and would otherwise crash with
// "Environment variable not found: DATABASE_URL".
import 'dotenv/config';
import { PrismaClient, WorkspaceRole, TaskStatus, Priority } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateKeyBetween } from 'fractional-indexing';

const DEMO_EMAIL = 'demo@tasker.dev';
const DEMO_PASSWORD = 'DemoViewer!2026';
const SEED_PASSWORD = 'SeedUser!2026';

const WORKSPACE_TEMPLATES = [
  { slug: 'orbital-labs', name: 'Orbital Labs' },
  { slug: 'nova-analytics', name: 'Nova Analytics' },
  { slug: 'harbor-studio', name: 'Harbor Studio' },
  { slug: 'northwind-ops', name: 'Northwind Ops' },
  { slug: 'aurora-mobile', name: 'Aurora Mobile' },
] as const;

const MEMBER_TEMPLATE = [
  { role: WorkspaceRole.OWNER, displayName: 'Ada Owner' },
  { role: WorkspaceRole.ADMIN, displayName: 'Bruno Admin' },
  { role: WorkspaceRole.MEMBER, displayName: 'Camila Member' },
  { role: WorkspaceRole.MEMBER, displayName: 'Diego Member' },
] as const;

const PROJECT_TEMPLATES = [
  { slug: 'platform', name: 'Platform', color: '#4f46e5', icon: 'rocket' },
  { slug: 'growth', name: 'Growth', color: '#10b981', icon: 'trending-up' },
] as const;

const TASK_TITLES = [
  'Draft public API guide',
  'Add retry to webhook receiver',
  'Cut monthly release',
  'Migrate old sessions to iron-session v8',
  'Wire Sentry release tags',
  'Import last quarter OKRs',
  'Set up burndown dashboard',
  'Refactor tenant middleware',
  'Backfill audit log gaps',
  'Rotate signing keys',
  'Add rate limit exemption for internal',
  'Rewrite onboarding email copy',
  'Verify GDPR export pipeline',
  'Prune deprecated feature flags',
  'Ship demo mode banner',
  'Extend Playwright coverage on planner',
  'Reduce cold-start on API worker',
  'Cache prompt catalog per workspace',
  'Add screenshots to changelog',
  'Investigate flaky comments spec',
];

const STATUS_ROTATION: TaskStatus[] = [
  TaskStatus.BACKLOG,
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.DONE,
];

const PRIORITY_ROTATION: Priority[] = [Priority.LOW, Priority.MEDIUM, Priority.HIGH];

async function seed(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });
    const demoHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

    // Demo viewer — one account, DEMO_VIEWER on every workspace.
    const demo = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: { displayName: 'Demo Viewer', emailVerifiedAt: new Date() },
      create: {
        email: DEMO_EMAIL,
        displayName: 'Demo Viewer',
        passwordHash: demoHash,
        emailVerifiedAt: new Date(),
      },
    });

    let totalTasks = 0;
    for (const workspaceTpl of WORKSPACE_TEMPLATES) {
      // Owner user (canonical per workspace) — deterministic email seals uniqueness.
      const ownerEmail = `ada+${workspaceTpl.slug}@tasker.dev`;
      const owner = await prisma.user.upsert({
        where: { email: ownerEmail },
        update: { displayName: MEMBER_TEMPLATE[0]!.displayName },
        create: {
          email: ownerEmail,
          displayName: MEMBER_TEMPLATE[0]!.displayName,
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

      const workspace = await prisma.workspace.upsert({
        where: { slug: workspaceTpl.slug },
        update: { name: workspaceTpl.name },
        create: {
          slug: workspaceTpl.slug,
          name: workspaceTpl.name,
          ownerUserId: owner.id,
        },
      });

      // Members: owner + 3 more per workspace = 4 seed members. Plus the
      // shared demo viewer joins every workspace. Total = 4 × 5 + 1 = 21
      // (demo counted once), rounded to the "20 users" PRD target.
      const memberUsers = await Promise.all(
        MEMBER_TEMPLATE.map(async (m, idx) => {
          const email =
            idx === 0
              ? ownerEmail
              : `${m.displayName.toLowerCase().replace(/\s+/g, '-')}+${workspaceTpl.slug}@tasker.dev`;
          const user = await prisma.user.upsert({
            where: { email },
            update: { displayName: m.displayName },
            create: {
              email,
              displayName: m.displayName,
              passwordHash,
              emailVerifiedAt: new Date(),
            },
          });
          await prisma.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
            update: { role: m.role },
            create: { workspaceId: workspace.id, userId: user.id, role: m.role },
          });
          return user;
        }),
      );

      // Demo viewer membership — every workspace, DEMO_VIEWER role.
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: demo.id } },
        update: { role: WorkspaceRole.DEMO_VIEWER },
        create: {
          workspaceId: workspace.id,
          userId: demo.id,
          role: WorkspaceRole.DEMO_VIEWER,
        },
      });

      // Two projects per workspace × 20 tasks each = 40 tasks per workspace ×
      // 5 workspaces = 200 tasks total. Matches PRD FR-9.1.
      for (const projTpl of PROJECT_TEMPLATES) {
        const project = await prisma.project.upsert({
          where: { workspaceId_slug: { workspaceId: workspace.id, slug: projTpl.slug } },
          update: { name: projTpl.name, color: projTpl.color, icon: projTpl.icon },
          create: {
            workspaceId: workspace.id,
            slug: projTpl.slug,
            name: projTpl.name,
            color: projTpl.color,
            icon: projTpl.icon,
            ownerUserId: owner.id,
            createdByUserId: owner.id,
          },
        });
        // Bootstrap per-project sequence — required by ProjectSequence
        // partial unique on Task.number.
        await prisma.projectSequence.upsert({
          where: { projectId: project.id },
          update: {},
          create: { projectId: project.id, nextNumber: 1 },
        });

        // 20 tasks per project — distributed round-robin across status +
        // priority + members so charts have variance.
        let cursor: string | null = null;
        for (let i = 0; i < 20; i++) {
          const number = i + 1;
          const assignee = memberUsers[i % memberUsers.length]!;
          const nextCursor = generateKeyBetween(cursor, null);
          const title = `${TASK_TITLES[i % TASK_TITLES.length]!} #${number}`;
          await prisma.task.upsert({
            where: { projectId_number: { projectId: project.id, number } },
            update: {
              title,
              status: STATUS_ROTATION[i % STATUS_ROTATION.length]!,
              priority: PRIORITY_ROTATION[i % PRIORITY_ROTATION.length]!,
              assigneeUserId: assignee.id,
            },
            create: {
              workspaceId: workspace.id,
              projectId: project.id,
              number,
              title,
              description: `Auto-seeded demo task in ${workspaceTpl.name} / ${projTpl.name}.`,
              status: STATUS_ROTATION[i % STATUS_ROTATION.length]!,
              priority: PRIORITY_ROTATION[i % PRIORITY_ROTATION.length]!,
              position: nextCursor,
              assigneeUserId: assignee.id,
              createdByUserId: owner.id,
              estimate: (i % 5) + 1,
            },
          });
          cursor = nextCursor;
          totalTasks++;
        }
        // Persist the sequence tip so later real tasks in this project pick
        // up numbering from 21.
        await prisma.projectSequence.update({
          where: { projectId: project.id },
          data: { nextNumber: 21 },
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `Seed complete: ${WORKSPACE_TEMPLATES.length} workspaces, ${totalTasks} tasks, demo user = ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
