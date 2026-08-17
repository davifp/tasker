import { expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { randomEmail, randomWorkspaceName } from './factories';
import { extractFirstUrl, waitForEmail } from './mailhog';
import { apiPost } from './csrf';

export interface OnboardedAccount {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  workspaceSlug: string;
}

function slugifyWorkspaceName(name: string): string {
  const suffix = randomBytes(3).toString('hex');
  return `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}-${suffix}`;
}

export async function onboardAccount(
  page: Page,
  overrides: Partial<OnboardedAccount> = {},
): Promise<OnboardedAccount> {
  const email = overrides.email ?? randomEmail('kanban');
  const password = overrides.password ?? 'Sup3r!Passw0rd';
  const displayName = overrides.displayName ?? 'Kanban User';
  const workspaceName = overrides.workspaceName ?? randomWorkspaceName();

  const registerResponse = await page.request.post('/api/auth/register', {
    data: { email, password, name: displayName },
  });
  if (!registerResponse.ok()) {
    throw new Error(
      `register failed: ${registerResponse.status()} ${await registerResponse.text()}`,
    );
  }

  const verificationMail = await waitForEmail(
    (mail) => mail.Content.Headers.To?.[0]?.includes(email) ?? false,
  );
  const verifyUrl = extractFirstUrl(verificationMail.Content.Body);
  if (!verifyUrl) throw new Error(`No verification URL in mail for ${email}`);
  await page.goto(verifyUrl);
  await expect(page.getByText(/email verified/i)).toBeVisible({ timeout: 10_000 });

  const workspaceSlug = slugifyWorkspaceName(workspaceName);
  const createResponse = await apiPost<{ slug: string }>(page, '/api/proxy/workspaces', {
    name: workspaceName,
    slug: workspaceSlug,
  });
  if (!createResponse.ok) {
    throw new Error(
      `workspace create failed: ${createResponse.status} ${JSON.stringify(createResponse.body)}`,
    );
  }
  const workspace = createResponse.body;
  const selectResponse = await page.request.post('/api/workspaces/select', {
    data: { slug: workspace.slug },
  });
  if (!selectResponse.ok()) {
    throw new Error(
      `workspace select failed: ${selectResponse.status()} ${await selectResponse.text()}`,
    );
  }

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

export async function signIn(
  page: Page,
  credentials: { email: string; password: string; redirectTo?: string },
): Promise<void> {
  const redirectTo = credentials.redirectTo ?? '/';
  const loginUrl =
    redirectTo === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
  await page.goto(loginUrl);
  // Already-authenticated context (e.g. inviteAndJoin's peer): /login
  // redirects via the per-page guard; just navigate to the target.
  if (!/\/login(\?|$)/.test(page.url())) {
    if (redirectTo !== '/') await page.goto(redirectTo);
    return;
  }
  await page.getByLabel(/^email$/i).fill(credentials.email);
  await page.getByLabel(/^password$/i).fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  if (redirectTo === '/') {
    await page.waitForURL('http://localhost:3000/');
  } else {
    const target = redirectTo.split('?')[0]!;
    await page.waitForURL((url) => url.pathname.startsWith(target));
  }
}
