import { useMutation, useQueryClient } from '@tanstack/react-query';
import { checklistsHttp } from '@/lib/http/checklists';
import { taskKeys } from '@/features/queryKeys';
import type { ChecklistItem } from '@/lib/http/types';

interface Coords {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

// A single checklist list slice under `taskKeys.checklist(...)`. All
// three mutations operate on it with the same snapshot/rollback shape.

export function useToggleChecklistItem({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.checklist(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    ChecklistItem,
    unknown,
    { itemId: string; checked: boolean },
    { previous: ChecklistItem[] | undefined }
  >({
    mutationFn: ({ itemId, checked }) =>
      checklistsHttp.update(workspaceSlug, projectSlug, taskNumber, itemId, { checked }),
    async onMutate({ itemId, checked }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChecklistItem[]>(key);
      if (previous) {
        queryClient.setQueryData<ChecklistItem[]>(
          key,
          previous.map((i) => (i.id === itemId ? { ...i, checked } : i)),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useReorderChecklistItem({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.checklist(workspaceSlug, projectSlug, taskNumber);

  return useMutation<
    ChecklistItem,
    unknown,
    { itemId: string; position: string },
    { previous: ChecklistItem[] | undefined }
  >({
    mutationFn: ({ itemId, position }) =>
      checklistsHttp.update(workspaceSlug, projectSlug, taskNumber, itemId, { position }),
    async onMutate({ itemId, position }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChecklistItem[]>(key);
      if (previous) {
        const patched = previous.map((i) => (i.id === itemId ? { ...i, position } : i));
        patched.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
        queryClient.setQueryData<ChecklistItem[]>(key, patched);
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRenameChecklistItem({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.checklist(workspaceSlug, projectSlug, taskNumber);
  return useMutation<
    ChecklistItem,
    unknown,
    { itemId: string; title: string },
    { previous: ChecklistItem[] | undefined }
  >({
    mutationFn: ({ itemId, title }) =>
      checklistsHttp.update(workspaceSlug, projectSlug, taskNumber, itemId, { title }),
    async onMutate({ itemId, title }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChecklistItem[]>(key);
      if (previous) {
        queryClient.setQueryData<ChecklistItem[]>(
          key,
          previous.map((i) => (i.id === itemId ? { ...i, title } : i)),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useAddChecklistItem({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.checklist(workspaceSlug, projectSlug, taskNumber);
  return useMutation<ChecklistItem, unknown, { title: string }>({
    mutationFn: ({ title }) =>
      checklistsHttp.create(workspaceSlug, projectSlug, taskNumber, { title }),
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteChecklistItem({ workspaceSlug, projectSlug, taskNumber }: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.checklist(workspaceSlug, projectSlug, taskNumber);
  return useMutation<void, unknown, { itemId: string }, { previous: ChecklistItem[] | undefined }>({
    mutationFn: ({ itemId }) =>
      checklistsHttp.remove(workspaceSlug, projectSlug, taskNumber, itemId),
    async onMutate({ itemId }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChecklistItem[]>(key);
      if (previous) {
        queryClient.setQueryData<ChecklistItem[]>(
          key,
          previous.filter((i) => i.id !== itemId),
        );
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
