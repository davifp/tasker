// Single source of truth for TanStack Query cache keys across the
// projects/tasks/labels/comments/checklist/dependencies surface. Every
// mutation hook composes its `invalidateQueries` call from one of these
// factory functions so a rename of the underlying entity slug or path
// segment fans out consistently and surgical invalidations stay narrow.
//
// Convention: [<entity>, <workspaceSlug>, <projectSlug?>, <id?>, <sub?>].
// Keeping the workspace segment first supports the multi-tenancy story —
// switching workspaces resets everything scoped under this key.

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
// ---------------------------------------------------------------------------

export const taskKeys = {
  all: (workspaceSlug: string, projectSlug: string) =>
    ['tasks', workspaceSlug, projectSlug] as const,
  list: (
    workspaceSlug: string,
    projectSlug: string,
    filters?: {
      status?: string;
      assigneeUserId?: string;
      labelId?: string;
      includeDeleted?: boolean;
    },
  ) => ['tasks', workspaceSlug, projectSlug, 'list', filters ?? {}] as const,
  detail: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number] as const,
  comments: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'comments'] as const,
  checklist: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'checklist'] as const,
  dependencies: (workspaceSlug: string, projectSlug: string, number: number) =>
    ['tasks', workspaceSlug, projectSlug, 'detail', number, 'dependencies'] as const,
};

// ---------------------------------------------------------------------------
// Labels — workspace-scoped catalog.
// ---------------------------------------------------------------------------

export const labelKeys = {
  all: (workspaceSlug: string) => ['labels', workspaceSlug] as const,
  list: (workspaceSlug: string) => ['labels', workspaceSlug, 'list'] as const,
};
