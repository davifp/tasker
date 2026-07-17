import { BarChart3, LayoutDashboard, LineChart, Users } from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavLink {
  key: string;
  href: (workspaceSlug: string) => string;
  match: (path: string, workspaceSlug: string) => boolean;
  icon: ComponentType<{ className?: string }>;
}

export const primaryNavLinks: NavLink[] = [
  {
    key: 'projects',
    href: (slug) => `/${slug}/projects`,
    match: (path, slug) => path === `/${slug}/projects` || path.startsWith(`/${slug}/projects/`),
    icon: LayoutDashboard,
  },
  {
    key: 'sprints',
    href: (slug) => `/${slug}/sprints`,
    match: (path, slug) => path === `/${slug}/sprints` || path.startsWith(`/${slug}/sprints/`),
    icon: BarChart3,
  },
  {
    key: 'roadmap',
    href: (slug) => `/${slug}/roadmap`,
    match: (path, slug) => path === `/${slug}/roadmap` || path.startsWith(`/${slug}/roadmap/`),
    icon: LineChart,
  },
  {
    key: 'dashboard',
    href: (slug) => `/${slug}/dashboard`,
    match: (path, slug) => path === `/${slug}/dashboard` || path.startsWith(`/${slug}/dashboard/`),
    icon: LineChart,
  },
];

export const managementNavLinks: NavLink[] = [
  {
    key: 'members',
    href: (slug) => `/${slug}/members`,
    match: (path, slug) => path === `/${slug}/members` || path.startsWith(`/${slug}/members/`),
    icon: Users,
  },
];

export function equivalentPathInWorkspace(
  current: string,
  currentSlug: string,
  targetSlug: string,
): string {
  if (current.startsWith(`/${currentSlug}/`)) {
    return current.replace(`/${currentSlug}/`, `/${targetSlug}/`);
  }
  if (current === `/${currentSlug}`) return `/${targetSlug}`;
  return `/${targetSlug}/projects`;
}
