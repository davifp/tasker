import { expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { randomEmail, randomWorkspaceName } from './factories';
import { extractFirstUrl, waitForEmail } from './mailhog';

export interface OnboardedAccount {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  workspaceSlug: string;
}

// Deterministic, cryptographically random slug suffix — Math.random() is
// not seeded across parallel workers and had a non-zero collision risk on
// 4-worker runs.
function slugifyWorkspaceName(name: string): string {
  const suffix = randomBytes(3).toString('hex');
  return `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}-${suffix}`;
}

// Cold-start onboarding via the API — signup + workspace-create + select.
// Faster and more deterministic than driving the UI through the same flow;
// each spec still exercises the post-onboarding surface (board, drawer,
// filters, deep link) via `page` normally. Email verification is bypassed
// by hitting the register endpoint and marking the user verified in the
// same trip via a dev-only backdoor if available; if not, we invoke the
// mail worker like the UI does.
export async function onboardAccount(
  page: Page,
  overrides: Partial<OnboardedAccount> = {},
): Promise<OnboardedAccount> {
  // Do NOT purge MailHog here — the inbox is shared across every parallel
  // worker, so wiping it would delete verification mails other workers are
  // waiting on. `waitForEmail` already filters by the unique per-worker
  // address, so leftover messages are harmless.
  const email = overrides.email ?? randomEmail('kanban');
  const password = overrides.password ?? 'Sup3r!Passw0rd';
  const displayName = overrides.displayName ?? 'Kanban User';
  const workspaceName = overrides.workspaceName ?? randomWorkspaceName();

  // 1. Register via the BFF (sets the iron-session cookie on `page.request`).
  const registerResponse = await page.request.post('/api/auth/register', {
    data: { email, password, name: displayName },
  });
  if (!registerResponse.ok()) {
    throw new Error(
      `register failed: ${registerResponse.status()} ${await registerResponse.text()}`,
    );
  }

  // 2. Verify email via the mailhog-delivered token so the user's session
  //    passes the "requires verified email" gate on downstream endpoints.
  const verificationMail = await waitForEmail(
    (mail) => mail.Content.Headers.To?.[0]?.includes(email) ?? false,
  );
  const verifyUrl = extractFirstUrl(verificationMail.Content.Body);
  if (!verifyUrl) throw new Error(`No verification URL in mail for ${email}`);
  await page.goto(verifyUrl);
  // Wait for the success affordance so the backend has definitely marked
  // the User row's emailVerifiedAt before we call gated endpoints below.
  await expect(page.getByText(/email verified/i)).toBeVisible({ timeout: 10_000 });

  // 3. Create the workspace via BFF proxy. Sets `x-tsk-workspace` cookie
  //    via the /api/workspaces/select follow-up.
  const workspaceSlug = slugifyWorkspaceName(workspaceName);
  const createResponse = await page.request.post('/api/proxy/workspaces', {
    data: { name: workspaceName, slug: workspaceSlug },
  });
  if (!createResponse.ok()) {
    throw new Error(
      `workspace create failed: ${createResponse.status()} ${await createResponse.text()}`,
    );
  }
  const workspace = (await createResponse.json()) as { slug: string };
  const selectResponse = await page.request.post('/api/workspaces/select', {
    data: { slug: workspace.slug },
  });
  if (!selectResponse.ok()) {
    throw new Error(
      `workspace select failed: ${selectResponse.status()} ${await selectResponse.text()}`,
    );
  }

  // 4. Land the browser on the projects list so downstream test steps
  //    start from a stable UI state (matches the redirect the UI would
  //    have performed).
  await page.goto(`/${workspace.slug}/projects`);
  await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/projects`));

  return {
    email,
    password,
    displayName,
    workspaceName,
    workspaceSlug: workspace.slug,
  };
}

// Fresh sign-in via the login form. Assumes the email is already verified.
//
// Pass a `redirectTo` when the caller knows the workspace/project it wants
// to land on — the login form respects the `redirectTo` search param and
// falls back to `/` (the demo landing page, not the projects surface) if
// none is provided. Historically the helper assumed the app auto-routed to
// `/{workspace}/projects`, which it never did; callers now supply the slug.
export async function signIn(
  page: Page,
  credentials: { email: string; password: string; redirectTo?: string },
): Promise<void> {
  const redirectTo = credentials.redirectTo ?? '/';
  const loginUrl =
    redirectTo === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
  await page.goto(loginUrl);
  await page.getByLabel(/^email$/i).fill(credentials.email);
  await page.getByLabel(/^password$/i).fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait for the redirect the form performs after a successful post. The
  // form navigates to `redirectTo`, but the destination itself may issue a
  // server-side redirect (e.g. `/{ws}/projects/{proj}` → landing view like
  // `/list`), so match on a prefix instead of an exact path.
  if (redirectTo === '/') {
    await page.waitForURL('http://localhost:3000/');
  } else {
    const target = redirectTo.split('?')[0]!;
    await page.waitForURL((url) => url.pathname.startsWith(target));
  }
}
