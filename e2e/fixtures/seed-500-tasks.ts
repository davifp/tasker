import type { Page } from '@playwright/test';
import { apiPost } from '../support/csrf';

// Deterministic 500-task fixture for the Task 9.0 spec. Uses a seeded
// pseudo-random distribution so a spec re-run against the same account
// produces the same tasks — no snapshot drift between runs.
//
// The seed is CONSTANT ON PURPOSE: the spec asserts on properties (e.g.
// "N tasks have a due date within the current 2-week window") that must
// be identical across CI runs. Rebasing the fixture also rebases the
// assertions if this seed changes.

type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

// Distribution weights derived from the PRD's "realistic workload"
// description: mostly TODO/IN_PROGRESS, with a healthy backlog and a
// long tail of DONE tasks kept for the burndown/velocity views.
const STATUS_WEIGHTS: Record<TaskStatus, number> = {
  BACKLOG: 20,
  TODO: 30,
  IN_PROGRESS: 25,
  IN_REVIEW: 10,
  DONE: 15,
};

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  LOW: 40,
  MEDIUM: 40,
  HIGH: 20,
};

const LABEL_NAMES = ['bug', 'feature', 'chore', 'docs', 'design'] as const;
const LABEL_COLORS = ['#ef4444', '#3b82f6', '#a3a3a3', '#22c55e', '#a855f7'] as const;

export interface SeedContext {
  page: Page;
  workspaceSlug: string;
  projectSlug: string;
}

export interface SeededFixture {
  labelIds: string[];
  taskCount: number;
}

// Mulberry32 — 32-bit deterministic PRNG. Small, self-contained, good
// enough distribution for spec fixtures. Do NOT swap for Math.random —
// that would kill reproducibility.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T extends string>(rand: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const roll = rand() * total;
  let cursor = 0;
  for (const [key, weight] of entries) {
    cursor += weight;
    if (roll < cursor) return key;
  }
  return entries[entries.length - 1]![0];
}

function toIsoDate(daysFromToday: number, today: Date): string {
  const stamp = new Date(today);
  stamp.setUTCDate(stamp.getUTCDate() + daysFromToday);
  stamp.setUTCHours(9, 0, 0, 0);
  return stamp.toISOString();
}

// Fisher-Yates — an unbiased shuffle. The previous `sort(() => rand()
// - 0.5)` version produces a heavily-biased permutation and would skew
// label distribution across the seeded set.
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function createLabel(ctx: SeedContext, name: string, color: string): Promise<string> {
  const response = await apiPost<{ id: string }>(
    ctx.page,
    `/api/proxy/workspaces/${ctx.workspaceSlug}/labels`,
    { name, color },
  );
  if (!response.ok) {
    throw new Error(
      `label create failed (${name}): ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response.body.id;
}

interface TaskPayload {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  labelIds?: string[];
  startDate?: string;
  dueDate?: string;
}

async function createTask(ctx: SeedContext, payload: TaskPayload): Promise<void> {
  const response = await apiPost(
    ctx.page,
    `/api/proxy/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}/tasks`,
    payload,
  );
  if (!response.ok) {
    throw new Error(
      `task create failed (${payload.title}): ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
}

/**
 * Seeds `count` tasks with realistic distribution across statuses,
 * priorities, labels, and start/due dates centered around "today".
 * Returns the label ids so spec assertions can reference them without
 * re-fetching.
 *
 * Runs task creations sequentially over the keep-alive connection —
 * concurrent posts race for the fractional-index tail and can produce
 * position collisions on some Postgres schedules; the sequential path
 * is fast enough for CI and stays deterministic.
 */
export async function seedFiveHundredTasks(ctx: SeedContext, count = 500): Promise<SeededFixture> {
  const rand = mulberry32(0xf1e57ed);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const labelIds: string[] = [];
  for (const [i, name] of LABEL_NAMES.entries()) {
    labelIds.push(await createLabel(ctx, name, LABEL_COLORS[i]!));
  }

  for (let i = 0; i < count; i += 1) {
    const status = weightedPick(rand, STATUS_WEIGHTS);
    const priority = weightedPick(rand, PRIORITY_WEIGHTS);
    // Roughly 60 % of tasks have a due date — Timeline and Calendar
    // need enough dated tasks per window to hit the render budget with
    // real work, but List/Backlog also need undated tasks to render.
    const hasDates = rand() < 0.6;
    const dueOffset = Math.floor((rand() - 0.4) * 45); // −18 .. +27 days
    const durationDays = 1 + Math.floor(rand() * 6);
    const attachLabel = rand() < 0.7;
    const payload: TaskPayload = {
      title: `Seed task ${i + 1}`,
      status,
      priority,
    };
    if (attachLabel) {
      const labelCount = rand() < 0.3 ? 2 : 1;
      payload.labelIds = shuffle(labelIds, rand).slice(0, labelCount);
    }
    if (hasDates) {
      payload.startDate = toIsoDate(dueOffset - durationDays, today);
      payload.dueDate = toIsoDate(dueOffset, today);
    }
    await createTask(ctx, payload);
  }

  return { labelIds, taskCount: count };
}
