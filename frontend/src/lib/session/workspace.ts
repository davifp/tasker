import { cookies } from 'next/headers';
import { WORKSPACE_COOKIE_NAME, getWorkspaceCookieOptions } from './config';

export interface WorkspaceCookie {
  id: string;
  slug: string;
}

export async function getWorkspaceCookie(): Promise<WorkspaceCookie | null> {
  const store = await cookies();
  const raw = store.get(WORKSPACE_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceCookie;
    if (!parsed.id || !parsed.slug) return null;
    return { id: parsed.id, slug: parsed.slug };
  } catch {
    return null;
  }
}

export async function setWorkspaceCookie(value: WorkspaceCookie): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE_NAME, JSON.stringify(value), getWorkspaceCookieOptions());
}

export async function clearWorkspaceCookie(): Promise<void> {
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE_NAME);
}

export function parseWorkspaceCookieValue(raw: string | undefined): WorkspaceCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceCookie;
    if (!parsed.id || !parsed.slug) return null;
    return { id: parsed.id, slug: parsed.slug };
  } catch {
    return null;
  }
}
