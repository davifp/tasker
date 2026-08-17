import type { Page } from '@playwright/test';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: T;
}

// Runs the mutation inside the browser via fetch, so `document.cookie` and
// the outgoing Cookie header always come from the same source of truth.
// `page.request.*` fires from Node with a CDP-lagged cookie snapshot: reading
// the CSRF cookie via `context.cookies()` returns the fresh browser value
// while the outgoing request carries Node's stale one — the double-submit
// check then compares fresh header against stale cookie and 403s. Executing
// inside the page eliminates the split.
async function browserFetch<T = unknown>(
  page: Page,
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  if (!page.url().startsWith('http')) {
    // `fetch(relativePath)` needs an origin; a page on `about:blank` (fresh
    // context) has none. Land on the app root once so document.cookie and
    // relative fetches work as they do for a real user.
    await page.goto('/');
  }
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrfRaw = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('tsk_csrf='))
        ?.slice('tsk_csrf='.length);
      const csrf = csrfRaw ? decodeURIComponent(csrfRaw) : undefined;
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        // non-JSON body: keep as text
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        ok: response.ok,
        status: response.status,
        headers,
        body: parsed as never,
      };
    },
    { path, method, body },
  );
}

export function apiPost<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return browserFetch<T>(page, path, 'POST', body);
}

export function apiPatch<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return browserFetch<T>(page, path, 'PATCH', body);
}

export function apiPut<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return browserFetch<T>(page, path, 'PUT', body);
}

export function apiDelete<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return browserFetch<T>(page, path, 'DELETE', body);
}
