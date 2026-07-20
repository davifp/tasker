import { browserHttp } from './browser';
import type { TaskStatus, Priority } from './types';

// Wire shape for `/me/view-preferences`. Mirrors the backend Zod schema in
// `backend/src/user-project-view-preferences/dto/view-preferences.dto.ts`.
// Every branch is optional so a partial patch is legal; the backend shallow-
// merges the body into the persisted row.

export type ViewName = 'board' | 'list' | 'backlog' | 'calendar' | 'timeline';

export interface ListPreferences {
  columns: string[];
  hidden: string[];
  sort: { by: string; dir: 'asc' | 'desc' };
}

export interface TimelinePreferences {
  windowWeeks: 2 | 4;
}

export interface FiltersMemo {
  status?: TaskStatus[];
  assigneeUserId?: string;
  labelIds?: string[];
  priority?: Priority[];
  from?: string;
  to?: string;
  sort?: 'dueDate' | 'updatedAt' | 'priority' | 'title' | 'position';
  sortDir?: 'asc' | 'desc';
}

export interface ViewPreferences {
  defaultView?: ViewName;
  list?: ListPreferences;
  timeline?: TimelinePreferences;
  filtersMemo?: FiltersMemo;
}

function base(workspaceSlug: string, projectSlug: string): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`;
}

export const viewPreferencesHttp = {
  get(workspaceSlug: string, projectSlug: string) {
    return browserHttp.get<ViewPreferences>(base(workspaceSlug, projectSlug));
  },
  update(workspaceSlug: string, projectSlug: string, patch: ViewPreferences) {
    return browserHttp.put<ViewPreferences>(base(workspaceSlug, projectSlug), patch);
  },
};
