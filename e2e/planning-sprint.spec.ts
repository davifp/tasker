import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject } from './support/board';

// PRD Fase 6 sprint entry point — after Task 10.0's follow-up fixes, the
// workspace-level `/sprints` route lists projects with a per-project
// "+ New sprint" affordance and the shadcn Dialog wired to the create
// endpoint. The full drag-into-sprint + rollover choreography still
// needs the backlog view to publish a task pool the sprint pane can
// consume from — deferred here to keep this spec deterministic against
// the current UI surface.

test.describe('Planning — sprint index', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('lists projects and creates a sprint via the dialog', async ({ page }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);

    await page.goto(`/${account.workspaceSlug}/sprints`);

    await expect(page.getByRole('heading', { level: 1, name: /^sprints$/i })).toBeVisible();
    const projectCard = page.getByTestId(`sprints-project-${project.slug}`);
    await expect(projectCard).toBeVisible();
    await expect(projectCard.getByText(/no sprints yet/i)).toBeVisible();

    // Open the create dialog for this project's card.
    await projectCard.getByTestId(`sprint-create-open-${project.slug}`).click();
    const dialog = page.getByRole('dialog', { name: /new sprint/i });
    await expect(dialog).toBeVisible();

    // Fill a 14-day sprint starting today.
    const today = new Date();
    const twoWeeksOut = new Date(today.getTime() + 14 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    await dialog.getByLabel(/^name$/i).fill('Alpha');
    await dialog.getByLabel(/^goal/i).fill('Ship the alpha planner');
    await dialog.getByLabel(/^start date$/i).fill(iso(today));
    await dialog.getByLabel(/^end date$/i).fill(iso(twoWeeksOut));
    await dialog.getByTestId('sprint-create-submit').click();

    // After success the dialog closes and TanStack invalidates the list.
    // The RSC index is server-rendered from the initial page load, so the
    // freshly created sprint appears only after a full reload; asserting
    // on the toast + closed dialog keeps this spec self-contained.
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/sprint created/i)).toBeVisible({ timeout: 5_000 });
  });
});
