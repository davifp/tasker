'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createEpicSchema, updateEpicSchema, type CreateEpicInput } from '@tasker/config';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HttpError } from '@/lib/http/errors';
import { epicsHttp, type Epic } from '@/lib/http/epics';
import { epicKeys } from '@/features/queryKeys';

export interface EpicDialogProps {
  workspaceSlug: string;
  projectSlug: string;
  epic: Epic | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EpicDialog({
  workspaceSlug,
  projectSlug,
  epic,
  open,
  onOpenChange,
}: EpicDialogProps): React.JSX.Element {
  const editing = epic !== null;
  const queryClient = useQueryClient();

  const form = useForm<CreateEpicInput>({
    resolver: zodResolver(editing ? updateEpicSchema : createEpicSchema),
    defaultValues: {
      title: epic?.title ?? '',
      description: epic?.description ?? undefined,
      startQuarter: epic?.startQuarter ?? '',
      endQuarter: epic?.endQuarter ?? '',
      status: epic?.status ?? 'PLANNED',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: CreateEpicInput) => {
      if (editing && epic) {
        return epicsHttp.update(workspaceSlug, epic.id, values);
      }
      const idempotencyKey = crypto.randomUUID();
      return epicsHttp.create(workspaceSlug, projectSlug, values, idempotencyKey);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: epicKeys.all(workspaceSlug) });
      onOpenChange(false);
      toast.success(editing ? 'Epic updated' : 'Epic created');
    },
    onError: (err) => {
      const message =
        err instanceof HttpError ? (err.detail ?? err.title ?? err.message) : 'Save failed';
      toast.error(message);
    },
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit epic' : 'New epic'}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="epic-title">Title</Label>
            <Input id="epic-title" {...form.register('title')} />
            {errors.title ? (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="epic-from">Start quarter</Label>
              <Input id="epic-from" placeholder="2026-Q3" {...form.register('startQuarter')} />
              {errors.startQuarter ? (
                <p className="text-xs text-destructive">{errors.startQuarter.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="epic-to">End quarter</Label>
              <Input id="epic-to" placeholder="2026-Q4" {...form.register('endQuarter')} />
              {errors.endQuarter ? (
                <p className="text-xs text-destructive">{errors.endQuarter.message}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
