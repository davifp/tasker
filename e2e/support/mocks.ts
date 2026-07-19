import type { Page } from '@playwright/test';

// Force the English locale for every navigation on the given page.
// Text-based assertions in the Task 10 specs match the EN copy; a stray
// `NEXT_LOCALE=pt-BR` cookie (from a peer spec or a browser default)
// would flip the copy and silently fail every regex.
export async function pinEnglishLocale(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'en', domain: 'localhost', path: '/' }]);
}

// Block real network calls to external integrations. If any spec
// unexpectedly attempts to reach one of these domains, page.route
// short-circuits the request with an obvious mock response.
export async function mockExternalIntegrations(page: Page): Promise<void> {
  await page.route(/anthropic\.com/i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-anthropic', content: [{ type: 'text', text: 'mock' }] }),
    }),
  );
  await page.route(/openai\.com/i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-openai', choices: [{ message: { content: 'mock' } }] }),
    }),
  );
  await page.route(/(s3|r2)[.-].*amazonaws|r2\.cloudflarestorage\.com/i, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: '' }),
  );
  await page.route(/(email\.us-.+\.amazonaws|api\.resend\.com|api\.sendgrid\.com)/i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-mail', status: 'queued' }),
    }),
  );
}
