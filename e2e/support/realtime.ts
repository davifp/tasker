import type { BrowserContext, Page } from '@playwright/test';
import { extractFirstUrl, waitForEmail } from './mailhog';
import { randomEmail } from './factories';
import { onboardAccount } from './auth';

// ---- Second-user onboarding into an existing workspace ---------------------
//
// The mention + realtime-collab specs need two users inside the *same*
// workspace. We reuse `onboardAccount` for the second user (which itself
// creates a personal workspace we ignore), then invite them via the API and
// accept the invitation in the second context. Doing this through the API
// keeps the spec fast and independent of the invite dialog's markup — which
// already has dedicated coverage in `auth-signup-workspace-invite.spec.ts`.

export interface JoinedMember {
  email: string;
  password: string;
  displayName: string;
  workspaceSlug: string;
}

interface JoinOptions {
  workspaceSlug: string;
  inviterPage: Page;
  inviteeContext: BrowserContext;
  role?: 'ADMIN' | 'MEMBER' | 'GUEST';
  displayName?: string;
}

// Onboards a fresh user in `inviteeContext`, has the inviter send an
// invitation, then redeems it on the invitee session. Returns the invitee's
// credentials + the joined workspace slug so the caller can `signIn` again
// or drive the browser directly.
export async function inviteAndJoin(opts: JoinOptions): Promise<JoinedMember> {
  const { workspaceSlug, inviterPage, inviteeContext, role = 'MEMBER' } = opts;

  const inviteePage = await inviteeContext.newPage();
  const displayName = opts.displayName ?? 'Invited Member';
  const account = await onboardAccount(inviteePage, {
    email: randomEmail('member'),
    displayName,
  });
  await inviteePage.close();

  const inviteResponse = await inviterPage.request.post(
    `/api/proxy/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
    {
      data: { email: account.email, role },
    },
  );
  if (!inviteResponse.ok()) {
    throw new Error(`invite failed: ${inviteResponse.status()} ${await inviteResponse.text()}`);
  }

  const inviteMail = await waitForEmail(
    (mail) =>
      (mail.Content.Headers.To?.[0]?.includes(account.email) ?? false) &&
      /invite/i.test(mail.Content.Headers.Subject?.[0] ?? ''),
  );
  const acceptUrl = extractFirstUrl(inviteMail.Content.Body);
  if (!acceptUrl) throw new Error(`No invitation URL for ${account.email}`);
  const token = acceptUrl.split('/').pop();
  if (!token) throw new Error(`Could not parse invitation token from ${acceptUrl}`);

  const acceptPage = await inviteeContext.newPage();
  // Redeem via the BFF proxy so the iron-session cookie authorises the call.
  const acceptResponse = await acceptPage.request.post(
    `/api/proxy/invitations/${encodeURIComponent(token)}/accept`,
    { data: {} },
  );
  if (!acceptResponse.ok()) {
    throw new Error(
      `invitation accept failed: ${acceptResponse.status()} ${await acceptResponse.text()}`,
    );
  }
  await acceptPage.request.post('/api/workspaces/select', {
    data: { slug: workspaceSlug },
  });
  await acceptPage.close();

  return {
    email: account.email,
    password: account.password,
    displayName,
    workspaceSlug,
  };
}

// ---- Web Push stubs --------------------------------------------------------
//
// The push-optin spec cannot rely on the browser's actual push service or
// service worker. We stub Notification.permission and navigator.serviceWorker
// so the RegisterPushToggle path completes without leaving Chromium and
// without touching Google's FCM endpoint.
export async function stubWebPush(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Grant permission before the UI reads it.
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });
    Notification.requestPermission = async () => 'granted' as NotificationPermission;

    // Stateful fake service worker registration. `subscribe()` seeds an
    // in-memory record so a follow-up `getSubscription()` (which the
    // unsubscribe path uses to find what to delete) returns the same
    // object. `unsubscribe()` clears it.
    let current: unknown = null;
    const fakeEndpoint = 'https://push.example.test/subscription/e2e-fake';
    function makeSub() {
      return {
        endpoint: fakeEndpoint,
        expirationTime: null,
        options: { applicationServerKey: null, userVisibleOnly: true },
        getKey: () => new Uint8Array([1, 2, 3]).buffer,
        unsubscribe: async () => {
          current = null;
          return true;
        },
        toJSON: () => ({
          endpoint: fakeEndpoint,
          keys: {
            p256dh: 'BAsdfBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            auth: 'AbcdefAAAAAAAAAAAAAAAA',
          },
        }),
      };
    }
    const fakeRegistration = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => {
          current = makeSub();
          return current;
        },
        permissionState: async () => 'granted' as PermissionState,
      },
      unregister: async () => true,
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        register: async () => fakeRegistration,
        ready: Promise.resolve(fakeRegistration),
        getRegistration: async () => fakeRegistration,
      }),
    });
  });
}
