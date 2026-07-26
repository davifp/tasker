import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';

// PRD Fase 6 dashboard surface. The four KPI cards, window picker, and
// Owner-only refresh CTA all render on first paint. Live burndown +
// distribution assertions require a warmed matview + a specific active
// sprint — deferred until the seed fixture pushes real snapshots.

test.describe('Planning — dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('renders KPI cards, chart panels, and definition tooltips', async ({ page }) => {
    const account = await onboardAccount(page);

    await page.goto(`/${account.workspaceSlug}/dashboard`);

    await expect(
      page.getByRole('heading', { level: 1, name: /planning dashboard/i }),
    ).toBeVisible();

    // Four KPI card labels — the Tooltip provider fix means these render
    // without crashing on the RSC.
    for (const label of [
      /median lead time/i,
      /p90 lead time/i,
      /median cycle time/i,
      /p90 cycle time/i,
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }

    // The four MetricDefinitionPopover trigger buttons each carry a stable
    // testid — asserting on presence catches a regression of the
    // `TooltipProvider` fix.
    await expect(page.getByTestId('metric-definition-leadTime')).toHaveCount(2);
    await expect(page.getByTestId('metric-definition-cycleTime')).toHaveCount(2);

    // Chart panel headings.
    await expect(page.getByRole('heading', { name: /cycle & lead time/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /burndown/i })).toBeVisible();

    // Window picker + refresh CTA (owner sees it because the RSC defaults
    // currentUserRole to OWNER until getWorkspaceSession lands).
    await expect(page.getByLabel(/metric window/i)).toBeVisible();
    await expect(page.getByTestId('dashboard-refresh')).toBeVisible();
  });
});
