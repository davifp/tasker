import type { Page } from '@playwright/test';

// Shared helpers to stub the AI backend at the BFF proxy layer so E2E specs
// never hit a real Anthropic / OpenAI account. The stubs intercept
// `/api/proxy/workspaces/*/ai/...` — the same URL prefix `aiHttp` and
// `openAiStream` post to — so the browser, Next.js BFF, and AI hook layer
// are all exercised end-to-end.

export interface AiUsageStubOptions {
  workspaceSlug?: string;
  billingMonth?: string;
  tokensBudget?: number;
  tokensReserved?: number;
  tokensConsumed?: number;
  consent?: {
    accepted?: boolean;
    acceptedDocumentVersion?: string;
    requiredDocumentVersion?: string;
    acceptedAt?: string;
    acceptedByUserId?: string;
  };
}

/**
 * Stubs `GET /workspaces/*​/ai/usage`. Call once per spec (or twice — the
 * second call replaces the first) to shape the banner + menu enabled/disabled
 * state independently of any real workspace budget.
 */
export async function stubAiUsage(page: Page, opts: AiUsageStubOptions = {}): Promise<void> {
  const payload = {
    workspaceId: 'stub-ws-id',
    billingMonth: opts.billingMonth ?? '2026-08',
    tokensBudget: opts.tokensBudget ?? 1_000_000,
    tokensReserved: opts.tokensReserved ?? 0,
    tokensConsumed: opts.tokensConsumed ?? 0,
    consent: {
      accepted: opts.consent?.accepted ?? false,
      acceptedDocumentVersion: opts.consent?.acceptedDocumentVersion,
      requiredDocumentVersion: opts.consent?.requiredDocumentVersion ?? 'v1',
      acceptedAt: opts.consent?.acceptedAt,
      acceptedByUserId: opts.consent?.acceptedByUserId,
    },
  };

  await page.route(matcher(opts.workspaceSlug, /\/ai\/usage$/), (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/**
 * Stubs `POST /workspaces/*​/ai/consent`. Returns 204 by default; specs can
 * combine this with an initial `stubAiUsage({consent:{accepted:false}})` and
 * then re-`stubAiUsage({consent:{accepted:true}})` inside `onAccept` to
 * simulate the "accept + refetch" flow.
 */
export async function stubAiConsentAccept(
  page: Page,
  workspaceSlug: string,
  onAccept?: () => Promise<void> | void,
): Promise<void> {
  await page.route(matcher(workspaceSlug, /\/ai\/consent$/), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (onAccept) await onAccept();
    await route.fulfill({ status: 204, body: '' });
  });
}

/**
 * Stubs `POST /workspaces/*​/ai/feedback`. Records every submitted body into
 * the returned array so the spec can assert on rating / reason.
 */
export function stubAiFeedback(page: Page, workspaceSlug: string) {
  const submissions: Array<{ invocationId: string; rating: string; reason?: string }> = [];
  page
    .route(matcher(workspaceSlug, /\/ai\/feedback$/), async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON() as {
        invocationId: string;
        rating: string;
        reason?: string;
      };
      submissions.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: `fb-${submissions.length}` }),
      });
    })
    .catch(() => undefined);
  return submissions;
}

/**
 * Stubs `POST /workspaces/*​/ai/tasks/*​/estimate-and-suggest`.
 */
export async function stubEstimateAndSuggest(
  page: Page,
  workspaceSlug: string,
  result: {
    invocationId?: string;
    estimate?: { low: number; high: number; confidence: 'low' | 'medium' | 'high' };
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    assignees?: Array<{ userId: string; reason: string }>;
    insufficientContext?: boolean;
  } = {},
): Promise<void> {
  const payload = {
    invocationId: result.invocationId ?? 'inv-estimate-1',
    result: {
      estimate: result.estimate ?? { low: 4, high: 8, confidence: 'medium' },
      priority: result.priority ?? 'MEDIUM',
      assignees: result.assignees ?? [],
      insufficientContext: result.insufficientContext ?? false,
    },
  };
  await page.route(matcher(workspaceSlug, /\/ai\/tasks\/[^/]+\/estimate-and-suggest$/), (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/**
 * Stubs an SSE endpoint. `frames` is a list of `[event, data]` pairs — the
 * helper appends a terminating `done` frame so callers only need to script
 * the interesting deltas.
 *
 * `problem` short-circuits everything and returns an `event: error` frame
 * built from a Problem Details payload — used by the budget-exhausted and
 * consent-required specs.
 */
export interface SseStubOptions {
  frames?: Array<{ event: string; data: string }>;
  problem?: { type: string; title: string; status: number; detail?: string };
  /** Milliseconds between frames — the delay lets specs assert the "streaming" affordance. */
  chunkDelayMs?: number;
}

export async function stubAiSse(
  page: Page,
  workspaceSlug: string,
  pathTail: RegExp,
  options: SseStubOptions,
): Promise<void> {
  await page.route(matcher(workspaceSlug, pathTail), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();

    if (options.problem) {
      const body = formatSseFrame('error', JSON.stringify(options.problem));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      });
      return;
    }

    const parts: string[] = [];
    for (const frame of options.frames ?? []) {
      parts.push(formatSseFrame(frame.event, frame.data));
    }
    parts.push(formatSseFrame('done', '{}'));

    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: parts.join(''),
    });
  });
}

function formatSseFrame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

function matcher(workspaceSlug: string | undefined, tail: RegExp): RegExp {
  const slug = workspaceSlug ? escapeRegex(workspaceSlug) : '[^/]+';
  return new RegExp(`/api/proxy/workspaces/${slug}${tail.source}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
