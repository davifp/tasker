import { browserHttp } from './browser';
import type { ChecklistItem } from './types';

export interface CreateChecklistItemInput {
  title: string;
}

export interface UpdateChecklistItemInput {
  title?: string;
  checked?: boolean;
  position?: string;
}

function base(workspaceSlug: string, projectSlug: string, taskNumber: number): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/checklist`;
}

export const checklistsHttp = {
  list(workspaceSlug: string, projectSlug: string, taskNumber: number) {
    return browserHttp.get<ChecklistItem[]>(base(workspaceSlug, projectSlug, taskNumber));
  },
  create(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    input: CreateChecklistItemInput,
  ) {
    return browserHttp.post<ChecklistItem>(base(workspaceSlug, projectSlug, taskNumber), input);
  },
  update(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    itemId: string,
    input: UpdateChecklistItemInput,
  ) {
    return browserHttp.patch<ChecklistItem>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/${itemId}`,
      input,
    );
  },
  remove(workspaceSlug: string, projectSlug: string, taskNumber: number, itemId: string) {
    return browserHttp.delete<void>(`${base(workspaceSlug, projectSlug, taskNumber)}/${itemId}`);
  },
};
