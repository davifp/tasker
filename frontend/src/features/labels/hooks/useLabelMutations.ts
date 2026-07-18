import { useMutation, useQueryClient } from '@tanstack/react-query';
import { labelsHttp, type CreateLabelInput, type UpdateLabelInput } from '@/lib/http/labels';
import { labelKeys } from '@/features/queryKeys';
import type { CursorPage, Label } from '@/lib/http/types';

// Labels are workspace-scoped and low-volume; a single invalidateQueries
// on the labels/list slice is cheap and keeps every consumer honest
// (dropdowns, filter bars, etc.).

export function useCreateLabel(workspaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation<Label, unknown, CreateLabelInput>({
    mutationFn: (input) => labelsHttp.create(workspaceSlug, input, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: labelKeys.all(workspaceSlug) });
    },
  });
}

export function useUpdateLabel(workspaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation<
    Label,
    unknown,
    { id: string; patch: UpdateLabelInput },
    { lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Label> | undefined }> }
  >({
    mutationFn: ({ id, patch }) => labelsHttp.update(workspaceSlug, id, patch),
    async onMutate({ id, patch }) {
      await queryClient.cancelQueries({ queryKey: labelKeys.all(workspaceSlug) });
      const lists = queryClient.getQueriesData<CursorPage<Label>>({
        queryKey: [...labelKeys.all(workspaceSlug), 'list'],
      });
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Label>>(key, {
          ...page,
          items: page.items.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        });
      }
      return { lists: lists.map(([queryKey, data]) => ({ queryKey, data })) };
    },
    onError(_err, _vars, snapshot) {
      if (!snapshot) return;
      for (const entry of snapshot.lists) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: labelKeys.all(workspaceSlug) });
    },
  });
}

export function useDeleteLabel(workspaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    unknown,
    { id: string },
    { lists: Array<{ queryKey: readonly unknown[]; data: CursorPage<Label> | undefined }> }
  >({
    mutationFn: ({ id }) => labelsHttp.remove(workspaceSlug, id),
    async onMutate({ id }) {
      await queryClient.cancelQueries({ queryKey: labelKeys.all(workspaceSlug) });
      const lists = queryClient.getQueriesData<CursorPage<Label>>({
        queryKey: [...labelKeys.all(workspaceSlug), 'list'],
      });
      for (const [key, page] of lists) {
        if (!page) continue;
        queryClient.setQueryData<CursorPage<Label>>(key, {
          ...page,
          items: page.items.filter((l) => l.id !== id),
        });
      }
      return { lists: lists.map(([queryKey, data]) => ({ queryKey, data })) };
    },
    onError(_err, _vars, snapshot) {
      if (!snapshot) return;
      for (const entry of snapshot.lists) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: labelKeys.all(workspaceSlug) });
    },
  });
}
