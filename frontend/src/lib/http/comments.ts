import { browserHttp } from './browser';
import type { Comment } from './types';

export interface CreateCommentInput {
  body: string;
}

export interface UpdateCommentInput {
  body: string;
}

function base(workspaceSlug: string, projectSlug: string, taskNumber: number): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/comments`;
}

export const commentsHttp = {
  list(workspaceSlug: string, projectSlug: string, taskNumber: number) {
    return browserHttp.get<Comment[]>(base(workspaceSlug, projectSlug, taskNumber));
  },
  create(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    input: CreateCommentInput,
    idempotencyKey?: string,
  ) {
    return browserHttp.post<Comment>(base(workspaceSlug, projectSlug, taskNumber), input, {
      idempotencyKey,
    });
  },
  update(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    id: string,
    input: UpdateCommentInput,
  ) {
    return browserHttp.patch<Comment>(
      `${base(workspaceSlug, projectSlug, taskNumber)}/${id}`,
      input,
    );
  },
  remove(workspaceSlug: string, projectSlug: string, taskNumber: number, id: string) {
    return browserHttp.delete<void>(`${base(workspaceSlug, projectSlug, taskNumber)}/${id}`);
  },
};
