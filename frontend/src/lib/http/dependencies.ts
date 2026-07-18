import { browserHttp } from './browser';
import type { TaskDependency } from './types';

export interface AddDependencyInput {
  blockedByTaskId: string;
}

function base(workspaceSlug: string, projectSlug: string, taskNumber: number): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/dependencies`;
}

export const dependenciesHttp = {
  list(workspaceSlug: string, projectSlug: string, taskNumber: number) {
    return browserHttp.get<TaskDependency[]>(base(workspaceSlug, projectSlug, taskNumber));
  },
  add(workspaceSlug: string, projectSlug: string, taskNumber: number, input: AddDependencyInput) {
    return browserHttp.post<TaskDependency>(base(workspaceSlug, projectSlug, taskNumber), input);
  },
  remove(workspaceSlug: string, projectSlug: string, taskNumber: number, blockerId: string) {
    return browserHttp.delete<void>(`${base(workspaceSlug, projectSlug, taskNumber)}/${blockerId}`);
  },
};
