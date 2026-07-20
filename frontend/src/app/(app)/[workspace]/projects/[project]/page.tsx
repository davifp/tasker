import { notFound, redirect } from 'next/navigation';
import { serverHttp } from '@/lib/http/server';
import { HttpError } from '@/lib/http/errors';
import type { Project } from '@/lib/http/types';
import type { ViewPreferences } from '@/lib/http/viewPreferences';
import { resolveLandingView } from '@/features/tasks/views/resolveLandingView';

interface PageProps {
  params: Promise<{ workspace: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function fetchProject(workspaceSlug: string, projectSlug: string): Promise<Project | null> {
  try {
    return await serverHttp.get<Project>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function fetchDefaultView(
  workspaceSlug: string,
  projectSlug: string,
): Promise<string | null> {
  try {
    const prefs = await serverHttp.get<ViewPreferences>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
    );
    return prefs.defaultView ?? null;
  } catch (error) {
    // A missing preference row is not an error — the endpoint returns
    // `{}`. Any other transport failure falls back to `board` so the
    // route stays reachable during a backend hiccup.
    if (error instanceof HttpError && error.status === 404) return null;
    return null;
  }
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildQuery(search: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === 'view') continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(key, v);
    } else if (value !== undefined) {
      out.append(key, value);
    }
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

export default async function ProjectIndexPage({ params, searchParams }: PageProps) {
  const { workspace: workspaceSlug, project: projectSlug } = await params;
  const search = await searchParams;
  const [project, serverDefault] = await Promise.all([
    fetchProject(workspaceSlug, projectSlug),
    fetchDefaultView(workspaceSlug, projectSlug),
  ]);
  if (!project) notFound();

  const urlView = firstParam(search['view']);
  const target = resolveLandingView({ urlView, serverDefaultView: serverDefault });
  const query = buildQuery(search);
  redirect(`/${workspaceSlug}/projects/${projectSlug}/${target}${query}`);
}
