import { redirect } from 'next/navigation';
import { getWorkspaceCookie } from '@/lib/session/workspace';
import { EXPIRE_PATH, fetchMyWorkspaces, verifySession } from '@/lib/session/require';

// Root landing router. Server-side redirects so the browser never renders a
// flash of unwanted content:
//   - unauthenticated → /login
//   - expired (cookie present, backend rejected JWT) → /api/auth/expire
//     (destroys the cookie in a Route Handler, then → /login)
//   - transient backend error → /login (best effort)
//   - session but no workspaces → /workspaces/new (create the first one)
//   - session + workspaces → the last-visited workspace's dashboard, or
//     the first membership when no cookie is set yet.
export default async function Home(): Promise<never> {
  const verified = await verifySession();
  if (verified.status === 'expired') redirect(`${EXPIRE_PATH}?next=/login`);
  if (verified.status !== 'authenticated') redirect('/login');

  const workspaces = await fetchMyWorkspaces(verified.session.accessToken);
  if (workspaces.length === 0) redirect('/workspaces/new');

  const cookie = await getWorkspaceCookie();
  const active = (cookie && workspaces.find((w) => w.slug === cookie.slug)) ?? workspaces[0]!;
  redirect(`/${active.slug}/dashboard`);
}
