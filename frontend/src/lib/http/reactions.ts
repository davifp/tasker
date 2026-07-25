import { browserHttp } from './browser';
import type { ReactionSummary } from './types';

function base(
  workspaceSlug: string,
  projectSlug: string,
  taskNumber: number,
  commentId: string,
): string {
  return `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${taskNumber}/comments/${commentId}/reactions`;
}

export const reactionsHttp = {
  list(workspaceSlug: string, projectSlug: string, taskNumber: number, commentId: string) {
    return browserHttp.get<ReactionSummary[]>(
      base(workspaceSlug, projectSlug, taskNumber, commentId),
    );
  },
  add(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    commentId: string,
    emoji: string,
  ) {
    return browserHttp.post<void>(
      `${base(workspaceSlug, projectSlug, taskNumber, commentId)}/${encodeURIComponent(emoji)}`,
    );
  },
  remove(
    workspaceSlug: string,
    projectSlug: string,
    taskNumber: number,
    commentId: string,
    emoji: string,
  ) {
    return browserHttp.delete<void>(
      `${base(workspaceSlug, projectSlug, taskNumber, commentId)}/${encodeURIComponent(emoji)}`,
    );
  },
};
