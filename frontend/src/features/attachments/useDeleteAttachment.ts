import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskKeys } from '@/features/queryKeys';
import { attachmentsHttp } from '@/lib/http/attachments';
import type { Attachment, CursorPage } from '@/lib/http/types';

interface Coords {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

/**
 * Optimistic delete: drops the row from the cached page immediately, rolls
 * back on error, and re-fetches on settlement so a concurrent add from
 * another user reconciles.
 */
export function useDeleteAttachment(coords: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.attachments(coords.workspaceSlug, coords.projectSlug, coords.taskNumber);
  const activityKey = taskKeys.activity(
    coords.workspaceSlug,
    coords.projectSlug,
    coords.taskNumber,
  );
  return useMutation<
    void,
    unknown,
    { attachmentId: string },
    { previous: CursorPage<Attachment> | undefined }
  >({
    mutationFn: ({ attachmentId }) =>
      attachmentsHttp.remove(
        coords.workspaceSlug,
        coords.projectSlug,
        coords.taskNumber,
        attachmentId,
      ),
    async onMutate({ attachmentId }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CursorPage<Attachment>>(key);
      if (previous) {
        queryClient.setQueryData<CursorPage<Attachment>>(key, {
          ...previous,
          items: previous.items.filter((a) => a.id !== attachmentId),
        });
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
