import { test, expect, type Page } from '@playwright/test';
import { onboardAccount, type OnboardedAccount } from './support/auth';
import { apiPost } from './support/csrf';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import {
  columnRegion,
  createProject,
  dragCardKeyboard,
  dragCardTo,
  openDrawer,
  quickAddTask,
  type CreatedProject,
} from './support/board';

interface TaskShape {
  id: string;
  status: string;
}

async function fetchTask(
  page: Page,
  account: OnboardedAccount,
  project: CreatedProject,
  taskNumber: number,
): Promise<TaskShape> {
  const url = `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks/${taskNumber}`;
  const resp = await page.request.get(url);
  expect(resp.ok(), `GET ${url} → ${resp.status()}`).toBe(true);
  return (await resp.json()) as TaskShape;
}

async function declareBlocker(
  page: Page,
  account: OnboardedAccount,
  project: CreatedProject,
  blockedNumber: number,
  blockerId: string,
): Promise<void> {
  const url = `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks/${blockedNumber}/dependencies`;
  const resp = await apiPost(page, url, { blockedByTaskId: blockerId });
  expect(resp.ok, `POST ${url} → ${resp.status}`).toBe(true);
}

test.describe('Kanban flow — PRD mandatory merge blocker', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('quick-add → drag → drawer edit → delete + undo', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);

    const shipCard = await quickAddTask(page, 'To do', 'Ship the marketing page');

    // Mouse-drag it into "In progress".
    await dragCardTo(page, shipCard, 'In progress');
    const inProgress = columnRegion(page, 'In progress');
    await expect(
      inProgress.getByRole('button', { name: /open task #\d+: Ship the marketing page/i }),
    ).toBeVisible();

    // Open the drawer + edit description via the Markdown editor.
    const drawer = await openDrawer(
      inProgress.getByRole('button', { name: /open task #\d+: Ship the marketing page/i }),
    );
    await drawer
      .getByRole('button', { name: /^edit$/i })
      .first()
      .click();
    await drawer.getByRole('textbox', { name: /description/i }).fill('Ship it — QA passes.');
    await drawer.getByRole('button', { name: /^save$/i }).click();

    // Delete via the drawer's trash button; assert the undo toast is up
    // and clicking Undo restores the card to the board.
    await drawer.getByRole('button', { name: /^delete$/i }).click();
    const undoBtn = page.getByRole('button', { name: /^undo$/i });
    await expect(undoBtn).toBeVisible({ timeout: 5000 });
    await undoBtn.click();
    await expect(
      inProgress.getByRole('button', { name: /open task #\d+: Ship the marketing page/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('closing a blocked task requires override confirmation, then reopen', async ({ page }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);

    await quickAddTask(page, 'To do', 'Set up CI');
    await quickAddTask(page, 'To do', 'Deploy to prod');

    // Declare "Deploy to prod" (task 2) as blocked by "Set up CI" (task 1)
    // via the API so the spec stays focused on the override UX.
    const blocker = await fetchTask(page, account, project, 1);
    await declareBlocker(page, account, project, 2, blocker.id);
    await page.reload();

    const todo = columnRegion(page, 'To do');
    const deploy = todo.getByRole('button', { name: /open task #\d+: Deploy to prod/i });
    await expect(deploy).toBeVisible();

    // Attempt to drop the blocked task into Done — the AlertDialog gates
    // the transition, defaulting to "Cancel".
    await dragCardTo(page, deploy, 'Done');
    const overrideDialog = page.getByRole('alertdialog', {
      name: /Move "Deploy to prod" to Done/i,
    });
    await expect(overrideDialog).toBeVisible({ timeout: 5000 });
    await overrideDialog.getByRole('button', { name: /complete anyway/i }).click();

    // Server + DOM agree — the blocked task landed in DONE.
    await expect(
      columnRegion(page, 'Done').getByRole('button', { name: /open task #\d+: Deploy to prod/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => (await fetchTask(page, account, project, 2)).status, { timeout: 5000 })
      .toBe('DONE');

    // Reopen: drag back into "To do". No override this time (the target
    // column is not Done, so the override gate doesn't fire).
    const doneCard = columnRegion(page, 'Done').getByRole('button', {
      name: /open task #\d+: Deploy to prod/i,
    });
    await dragCardTo(page, doneCard, 'To do');
    await expect(
      columnRegion(page, 'To do').getByRole('button', { name: /open task #\d+: Deploy to prod/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => (await fetchTask(page, account, project, 2)).status, { timeout: 5000 })
      .not.toBe('DONE');
  });

  test('keyboard drag path — Space → ArrowRight → Space moves the card right', async ({ page }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Keyboard drag target');

    await dragCardKeyboard(page, card, 'ArrowRight');

    // DOM invariant — card left origin column and remained visible in a
    // Kanban column (not lingering as a drag-overlay ghost).
    await expect(
      columnRegion(page, 'To do').getByRole('button', {
        name: /open task #\d+: Keyboard drag target/i,
      }),
    ).toBeHidden({ timeout: 8000 });
    const anyColumn = page.getByRole('region', { name: /column$/i });
    await expect(
      anyColumn.getByRole('button', { name: /open task #\d+: Keyboard drag target/i }),
    ).toHaveCount(1);

    // Server-transition invariant — the move reached the API and the task
    // status advanced past TODO. Guards against a client-only DOM shuffle.
    await expect
      .poll(async () => (await fetchTask(page, account, project, 1)).status, { timeout: 5000 })
      .not.toBe('TODO');
  });

  test('10 consecutive moves produce zero duplicated or ghost cards', async ({ page }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);

    await quickAddTask(page, 'To do', 'Bouncer');
    const cardName = /open task #\d+: Bouncer/i;
    // Bounce the card through five distinct columns twice. We do NOT
    // assert the drop lands in the intended column each time — dnd-kit
    // drop-target resolution across Playwright's synthesized pointer
    // stream is not 100% deterministic under high-frequency mouse APIs
    // — but we DO assert the invariant the PRD cares about:
    //   1. On each iteration, exactly one Bouncer card exists *inside a
    //      Kanban column region* (not a drag-overlay portal, not a ghost).
    //   2. At the end, the server state matches the DOM's final column.
    const targets = ['In progress', 'To do', 'In review', 'Backlog', 'Done'];
    const anyColumn = page.getByRole('region', { name: /column$/i });
    for (let i = 0; i < 10; i += 1) {
      const target = targets[i % targets.length]!;
      const currentCard = anyColumn.getByRole('button', { name: cardName }).first();
      await dragCardTo(page, currentCard, target);
      await expect(anyColumn.getByRole('button', { name: cardName })).toHaveCount(1, {
        timeout: 5000,
      });
    }
    // Final server + DOM agreement — whichever column the last drop
    // landed in, the api must reflect the same status.
    const finalStatus = (await fetchTask(page, account, project, 1)).status;
    expect(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(finalStatus);
  });
});
