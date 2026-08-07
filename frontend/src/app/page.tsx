import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session/session';
import { getWorkspaceCookie } from '@/lib/session/workspace';
import { fetchMyWorkspaces } from '@/lib/session/require';

// Root landing router. Server-side redirects so the browser never renders a
// flash of unwanted content:
//   - No session → /login
//   - Session but no workspaces → /workspaces/new (create the first one)
//   - Session + workspaces → the last-visited workspace's dashboard, or
//     the first membership when no cookie is set yet.
export default async function Home(): Promise<never> {
  const session = await getSession();
  if (!session) redirect('/login');

  const workspaces = await fetchMyWorkspaces(session.accessToken);
  if (workspaces.length === 0) redirect('/workspaces/new');

  const cookie = await getWorkspaceCookie();
  const active = (cookie && workspaces.find((w) => w.slug === cookie.slug)) ?? workspaces[0]!;
  redirect(`/${active.slug}/dashboard`);
}
