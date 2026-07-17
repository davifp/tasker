import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PUBLIC_ROUTES = [
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
];

test.describe('accessibility — public surfaces', () => {
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
