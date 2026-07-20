import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { onboardAccount, signIn, type OnboardedAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, type CreatedProject } from './support/board';
import { seedFiveHundredTasks, type SeededFixture } from './fixtures/seed-500-tasks';
import { expectWithinRenderBudget } from './support/perf';

// One seeded account/project shared across every test in this file.
// Seeding 500 tasks costs several seconds; running it per-test would push
// the suite past the CI's Playwright budget for no benefit. `describe.
// serial` guarantees order so tests that mutate durable state (backlog
// reorder, prefs PUT) don't race each other on retry.
//
// NOTE: `beforeAll` closes its own context so its cookies don't leak; the
// per-test `page` fixture starts fresh and re-runs `signIn`. Do not try to
// "optimize" by keeping the seeder's context open — it silently races
// with per-test sessions and destabilizes the whole file.

interface SharedState {
  account: OnboardedAccount;
  project: CreatedProject;
  fixture: SeededFixture;
}

const shared: Partial<SharedState> = {};

function getShared(): SharedState {
  if (!shared.account || !shared.project || !shared.fixture) {
    throw new Error('shared fixture missing — beforeAll did not run');
  }
  return shared as SharedState;
}

async function boot(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await pinEnglishLocale(page);
  await mockExternalIntegrations(page);
  return page;
}

const LANDMARK = {
  list: 'list-table',
  backlog: 'backlog-list',
  calendar: 'calendar-view',
  timeline: 'timeline-view',
} as const;

const TAB_LABEL = {
  list: 'List',
  backlog: 'Backlog',
  calendar: 'Calendar',
  timeline: 'Timeline',
} as const;

type ViewName = keyof typeof LANDMARK;

test.describe.serial('Additional views — E2E, accessibility, performance', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await boot(context);
    const account = await onboardAccount(page);
    const project = await createProject(page);
    const fixture = await seedFiveHundredTasks({
      request: page.request,
      workspaceSlug: account.workspaceSlug,
      projectSlug: project.slug,
    });
    shared.account = account;
    shared.project = project;
    shared.fixture = fixture;
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    const { account } = getShared();
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
    await signIn(page, { email: account.email, password: account.password });
  });

  test('filter set survives List → Backlog → Calendar → Timeline cycle', async ({ page }) => {
    const { account, project } = getShared();
    // Assignee filter encoded in the URL is the canonical preserved
    // signal — the UI header renders differently across views, but the
    // query string is the single source of truth every view reads.
    await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/list?assignee=me`);
    await expect(page).toHaveURL(/\/list\?assignee=me/);
    await expect(page.getByTestId('list-table')).toBeVisible();

    const cycle: ViewName[] = ['backlog', 'calendar', 'timeline', 'list'];
    for (const view of cycle) {
      await page.getByRole('tab', { name: new RegExp(`^${TAB_LABEL[view]}$`, 'i') }).click();
      // Assert both segment AND query — a regression that silently kept
      // us on the previous view would still contain assignee=me but
      // wouldn't cross into the target route.
      await expect(page).toHaveURL(new RegExp(`/${view}\\?assignee=me$`));
      await expect(page.getByTestId(LANDMARK[view])).toBeVisible();
    }
  });

  test('four-view cycle triggers one client-side /tasks GET for equal filters', async ({
    page,
  }) => {
    const { account, project } = getShared();
    const requests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // The browser sees `/api/proxy/…/tasks` — the BFF forwards to the
      // Nest backend server-side, so this counts client-initiated hops
      // only. RSC render fetches don't traverse the browser network
      // stack and would be invisible here regardless.
      if (
        req.method() === 'GET' &&
        url.includes(
          `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks`,
        ) &&
        !/\/tasks\/\d+(?:\?|$)/.test(url)
      ) {
        requests.push(url);
      }
    });

    await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/list`);
    await expect(page.getByTestId('list-table')).toBeVisible();

    const cycle: ViewName[] = ['backlog', 'calendar', 'timeline', 'list'];
    for (const view of cycle) {
      await page.getByRole('tab', { name: new RegExp(`^${TAB_LABEL[view]}$`, 'i') }).click();
      // Wait for the destination view to actually paint on cached data —
      // if it were going to refetch, the request would have fired by now.
      await expect(page.getByTestId(LANDMARK[view])).toBeVisible();
    }

    expect(requests, requests.join('\n')).toHaveLength(1);
  });

  test('backlog reorder round-trips to the server', async ({ page }) => {
    const { account, project } = getShared();
    await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/backlog`);
    const list = page.getByTestId('backlog-list');
    await expect(list).toBeVisible();

    const rows = list.getByRole('listitem');
    const topBefore = await rows.first().getAttribute('data-task-number');
    expect(topBefore).toBeTruthy();

    // Keyboard-drag the top item down one slot: focus handle → Space →
    // ArrowDown → Space. dnd-kit's KeyboardSensor handles the shuffle.
    const dragHandle = list.getByTestId(`backlog-drag-${topBefore}`);
    await dragHandle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');

    // Idempotent invariant — after the drag, the "was-at-top" row is no
    // longer at the top. Framed this way, a CI retry that starts from the
    // already-mutated state still passes because the newly-mutated state
    // continues to satisfy the invariant.
    await expect
      .poll(async () => rows.first().getAttribute('data-task-number'))
      .not.toBe(topBefore);

    // Round-trip via the API — the position must have hit the server.
    // Poll because the move mutation is fire-and-forget from the DOM's
    // perspective; the server ACK may lag the visible reorder.
    await expect
      .poll(
        async () => {
          const resp = await page.request.get(
            `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks?limit=5&sort=position&sortDir=asc`,
          );
          if (!resp.ok()) return topBefore; // trigger a retry
          const body = (await resp.json()) as { items: Array<{ number: number }> };
          return String(body.items[0]?.number ?? '');
        },
        { timeout: 10_000 },
      )
      .not.toBe(topBefore);
  });

  test('deep link with filters + view lands on the encoded surface', async ({ page }) => {
    const { account, project } = getShared();
    const url = `/${account.workspaceSlug}/projects/${project.slug}/timeline?window=4&priority=HIGH`;
    await page.goto(url);
    await expect(page).toHaveURL(/\/timeline\?window=4&priority=HIGH/);
    await expect(page.getByTestId('timeline-view')).toHaveAttribute('data-window-weeks', '4');
  });

  test('cross-device: durable pref on context A visible on context B after reload', async ({
    browser,
  }) => {
    const { account, project } = getShared();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await boot(contextA);
      await signIn(pageA, { email: account.email, password: account.password });
      await pageA.goto(`/${account.workspaceSlug}/projects/${project.slug}/timeline`);
      await expect(pageA.getByTestId('timeline-view')).toBeVisible();

      // Wait on the actual PUT response — a fixed sleep races the
      // 300 ms debounce and a slow CI runner will both under- and
      // over-shoot the write window.
      const putWaiter = pageA.waitForResponse(
        (resp) =>
          resp.request().method() === 'PUT' &&
          resp
            .url()
            .includes(
              `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/me/view-preferences`,
            ) &&
          resp.ok(),
        { timeout: 10_000 },
      );
      await pageA.getByTestId('timeline-window-4w').click();
      await expect(pageA.getByTestId('timeline-view')).toHaveAttribute('data-window-weeks', '4');
      await putWaiter;

      const pageB = await boot(contextB);
      await signIn(pageB, { email: account.email, password: account.password });
      // No `?window=` on the URL — the durable pref must fill in.
      await pageB.goto(`/${account.workspaceSlug}/projects/${project.slug}/timeline`);
      await expect(pageB.getByTestId('timeline-view')).toHaveAttribute('data-window-weeks', '4');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  for (const view of ['list', 'backlog', 'calendar', 'timeline'] as const) {
    test(`axe scan — ${view} view has no serious or critical WCAG 2.1 AA violations`, async ({
      page,
    }) => {
      const { account, project } = getShared();
      await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/${view}`);
      await expect(page.getByTestId(LANDMARK[view])).toBeVisible();

      // `wcag21aa` supersets 2.0 A/AA — one tag is sufficient.
      const results = await new AxeBuilder({ page }).withTags(['wcag21aa']).analyze();
      const blocking = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

  for (const view of ['list', 'backlog', 'calendar', 'timeline'] as const) {
    test(`render time under budget — ${view} view on 500-task fixture`, async ({ page }) => {
      const { account, project } = getShared();
      // Warm the shared TanStack Query cache from the Kanban board first
      // so the tab-click render measures a hydrated, cache-primed view —
      // the PRD's 200 ms budget targets steady-state view render, not
      // the initial cold-cache network round-trip.
      await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/board`);
      await expect(page.getByRole('region', { name: /column$/i }).first()).toBeVisible();

      // Playwright `<Link>` clicks trigger a Next.js soft navigation —
      // the target page's `performance` object is *the same* document
      // (client-side transition), so browser marks would persist, but
      // measuring in Node avoids any observability gap and keeps the
      // assertion source-of-truth in the test runner.
      const startedAt = Date.now();
      await page.getByRole('tab', { name: new RegExp(`^${TAB_LABEL[view]}$`, 'i') }).click();
      await expect(page.getByTestId(LANDMARK[view])).toBeVisible();
      const elapsedMs = Date.now() - startedAt;
      expectWithinRenderBudget(elapsedMs, `view:${view}`);
    });
  }
});
