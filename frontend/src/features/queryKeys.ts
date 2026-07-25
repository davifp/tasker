// Single source of truth for TanStack Query cache keys across the
// projects/tasks/labels/comments/checklist/dependencies surface. Every
// mutation hook composes its `invalidateQueries` call from one of these
// factory functions so a rename of the underlying entity slug or path
// segment fans out consistently and surgical invalidations stay narrow.
//
// Convention: [<entity>, <workspaceSlug>, <projectSlug?>, <id?>, <sub?>].
// Keeping the workspace segment first supports the multi-tenancy story —
// switching workspaces resets everything scoped under this key.

import type { Priority, TaskStatus } from '@/lib/http/types';

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projectKeys = {
  all: (workspaceSlug: string) => ['projects', workspaceSlug] as const,
  list: (workspaceSlug: string, filters?: { status?: string; includeDeleted?: boolean }) =>
    ['projects', workspaceSlug, 'list', filters ?? {}] as const,
  detail: (workspaceSlug: string, projectSlug: string) =>
    ['projects', workspaceSlug, 'detail', projectSlug] as const,
};

// ---------------------------------------------------------------------------
// Tasks + sub-resources (comments, checklist, dependencies) are keyed by
// (workspaceSlug, projectSlug, taskNumber) so the invalidation of one task
// never sprays the entire board.
//
// The `TaskFilters` shape below is the *unified* filter set the alternative
// views (List, Backlog, Calendar, Timeline) share with the Kanban board.
// Permutations of the same filter set MUST produce byte-identical query
// keys — otherwise switching views triggers a redundant re-fetch and
// breaks the "one hop per filter change" PRD invariant. `canonicalize`
// guarantees that invariant.
// ---------------------------------------------------------------------------

export type TaskSortField = 'dueDate' | 'updatedAt' | 'priority' | 'title' | 'position';

export type TaskSortDir = 'asc' | 'desc';

export interface TaskFilters {
  status?: TaskStatus[];
  // Always a resolved userId — the `'me'` sentinel lives upstream in
  // `ProjectFilters` and is expanded by `toTaskFilters()` before it ever
  // reaches the cache-key layer. Keeping the sentinel out of this type
  // prevents two callers from producing distinct keys for the same user.
  assigneeUserId?: string;
  labelIds?: string[];
  priority?: Priority[];
  // ISO datetime strings — see TaskFilters ADR in techspec.
  from?: string;
  to?: string;
  sort?: TaskSortField;
  sortDir?: TaskSortDir;
  // Legacy Phase-3 fields still consumed by mutation hooks and the board
  // list HTTP fetcher. Kept optional here so today's callers pass their
  // subset without breakage.
  labelId?: string;
  includeDeleted?: boolean;
}

// Fields whose ordering carries no meaning — sorted ascending during
// canonicalization so `{labels:[b,a]}` and `{labels:[a,b]}` hash equal.
const ARRAY_KEYS: readonly (keyof TaskFilters)[] = ['status', 'labelIds', 'priority'];

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Sorts array members, drops undefined/null/empty-string/empty-array keys,
 * and returns the resulting object shallow-frozen so consumers cannot
 * accidentally mutate the cache-key identity. Pure — never mutates its
 * input.
 *
 * Freeze semantics: the OUTER object is `Object.freeze`d. The nested
 * arrays (`status`, `labelIds`, `priority`) are fresh copies produced via
 * spread-then-sort, so they do not alias the caller's arrays — but they
 * are NOT deep-frozen (that extra work would run on every
 * `useProjectTasks` render). Consumers must treat those arrays as
 * read-only and never splice/push/sort them in place.
 *
 * Case is preserved intentionally: `assigneeUserId`/`labelIds`/`from`/`to`
 * are IDs or ISO timestamps where case is meaningful. The enum-like fields
 * (`status`, `priority`, `sort`, `sortDir`) are already produced by typed
 * callers with normalized casing, so no runtime case coercion is applied.
 */
export function canonicalize(filters: TaskFilters): TaskFilters {
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(filters).sort() as Array<keyof TaskFilters>) {
    const raw = filters[key];
    if (isEmptyValue(raw)) continue;
    if (Array.isArray(raw) && ARRAY_KEYS.includes(key)) {
      // Copy-then-sort so we do not mutate the caller's array.
      next[key] = [...raw].sort();
      continue;
    }
    next[key] = raw;
  }
  return Object.freeze(next) as TaskFilters;
}

export const taskKeys = {
  all: (workspaceSlug: string, projectSlug: string) =>
    ['tasks', workspaceSlug, projectSlug] as const,
  list: (workspaceSlug: string, projectSlug: string, filters?: TaskFilters) =>
    ['tasks', workspaceSlug, projectSlug, 'list', canonicalize(filters ?? {})] as const,
  detail: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number] as const,
  comments: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'comments'] as const,
  checklist: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'checklist'] as const,
  dependencies: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'dependencies'] as const,
  attachments: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'attachments'] as const,
  activity: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'activity'] as const,
  reactions: (workspaceSlug: string, projectSlug: string, number: number, commentId: string) =>
    [
      'tasks',
      workspaceSlug,
      projectSlug,
      'detail',
      number,
      'comments',
      commentId,
      'reactions',
    ] as const,
};

// ---------------------------------------------------------------------------
// Labels — workspace-scoped catalog.
// ---------------------------------------------------------------------------

export const labelKeys = {
  all: (workspaceSlug: string) => ['labels', workspaceSlug] as const,
  list: (workspaceSlug: string) => ['labels', workspaceSlug, 'list'] as const,
};
