import { useMutation, useQueryClient } from '@tanstack/react-query';
import { commentsHttp } from '@/lib/http/comments';
import { taskKeys } from '@/features/queryKeys';
import type { Comment } from '@/lib/http/types';

interface Coords {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

// Comments hooks. Each optimistically mutates the ordered list slice
// (`taskKeys.comments`) — Add appends, edit patches body in place,
// delete filters out. Rollback restores the pre-mutation array on 4xx.

export function useAddComment({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.comments(workspaceSlug, projectSlug, taskNumber);
  const activityKey = taskKeys.activity(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    Comment,
    unknown,
    { body: string; authorUserId: string },
    { previous: Comment[] | undefined; optimisticId: string }
  >({
    mutationFn: ({ body }) =>
      commentsHttp.create(workspaceSlug, projectSlug, taskNumber, { body }, crypto.randomUUID()),
    async onMutate({ body, authorUserId }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Comment[]>(key);
      const now = new Date().toISOString();
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: Comment = {
        id: optimisticId,
        workspaceId: '',
        taskId: '',
        authorUserId,
        body,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      queryClient.setQueryData<Comment[]>(key, [...(previous ?? []), optimistic]);
      return { previous, optimisticId };
    },
    onSuccess(created, _vars, ctx) {
      // Replace the optimistic row with the server-returned Comment *before*
      // the invalidate refetch lands. Otherwise a child feature (reactions,
      // attachments, mentions) fires against the placeholder id and 404s.
      queryClient.setQueryData<Comment[]>(key, (prev) =>
        (prev ?? []).map((c) => (c.id === ctx.optimisticId ? created : c)),
      );
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: activityKey });
    },
  });
}

export function useEditComment({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.comments(workspaceSlug, projectSlug, taskNumber);
  const activityKey = taskKeys.activity(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    Comment,
    unknown,
    { id: string; body: string },
    { previous: Comment[] | undefined }
  >({
    mutationFn: ({ id, body }) =>
      commentsHttp.update(workspaceSlug, projectSlug, taskNumber, id, { body }),
    async onMutate({ id, body }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Comment[]>(key);
      if (previous) {
        queryClient.setQueryData<Comment[]>(
          key,
          previous.map((c) => (c.id === id ? { ...c, body } : c)),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: activityKey });
    },
  });
}

export function useDeleteComment({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.comments(workspaceSlug, projectSlug, taskNumber);
  const activityKey = taskKeys.activity(workspaceSlug, projectSlug, taskNumber);

  return useMutation<void, unknown, { id: string }, { previous: Comment[] | undefined }>({
    mutationFn: ({ id }) => commentsHttp.remove(workspaceSlug, projectSlug, taskNumber, id),
    async onMutate({ id }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Comment[]>(key);
      if (previous) {
        queryClient.setQueryData<Comment[]>(
          key,
          previous.filter((c) => c.id !== id),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: activityKey });
    },
  });
}
