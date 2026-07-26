import type { APIRequestContext } from '@playwright/test';

/**
 * Seeds a project with `count` tasks and deterministically-assigned
 * estimates so the sprint planner + burndown specs can assert stable
 * point totals across runs. Reuses the tokenised backend API path from
 * `seed-500-tasks.ts`; keeps the shape narrow so it does not drift when
 * the API adds new optional fields.
 */

export interface SeedContext {
  request: APIRequestContext;
  workspaceSlug: string;
  projectSlug: string;
  accessToken: string;
}

export interface SeededTask {
  id: string;
  number: number;
  title: string;
  estimate: number;
}

const ESTIMATE_CYCLE = [1, 2, 3, 5, 8] as const;

export async function seedTasksWithEstimates(
  ctx: SeedContext,
  count: number,
): Promise<SeededTask[]> {
  const base = `/api/v1/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}/tasks`;
  const created: SeededTask[] = [];

  for (let i = 0; i < count; i++) {
    const estimate = ESTIMATE_CYCLE[i % ESTIMATE_CYCLE.length]!;
    const response = await ctx.request.post(base, {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: `Planned task ${i + 1}`,
        priority: 'MEDIUM',
        estimate,
      },
    });
    if (!response.ok()) {
      throw new Error(`Failed to seed task ${i + 1}: ${response.status()}`);
    }
    const task = (await response.json()) as { id: string; number: number; title: string };
    created.push({ id: task.id, number: task.number, title: task.title, estimate });
  }

  return created;
}
