import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';

const PUBLIC_ROUTES = [
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
];

test.describe('accessibility — public surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(route.path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact ?? ''),
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

  test('a keyboard user reaches the skip-to-content link on the first Tab', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.textContent);
    expect(active?.toLowerCase()).toContain('skip to main content');
  });
});

test.describe('accessibility — authenticated project surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('project board has no serious or critical axe violations', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    // Seed one card so we hit both the empty column placeholder and a
    // rendered TaskCard variant in the same scan.
    await quickAddTask(page, 'To do', 'A11y check card');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('task drawer has no serious or critical axe violations', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'A11y drawer card');
    await openDrawer(card);

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
