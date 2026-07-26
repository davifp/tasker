'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createSprintSchema, type CreateSprintInput } from '@tasker/config';
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
import { sprintsHttp } from '@/lib/http/sprints';
import { sprintKeys } from '@/features/queryKeys';

export interface SprintCreateDialogProps {
  workspaceSlug: string;
  projectSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SprintCreateDialog({
  workspaceSlug,
  projectSlug,
  open,
  onOpenChange,
}: SprintCreateDialogProps): React.JSX.Element {
  const queryClient = useQueryClient();

  const form = useForm<CreateSprintInput>({
    resolver: zodResolver(createSprintSchema),
    defaultValues: { name: '', goal: undefined, startDate: '', endDate: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: CreateSprintInput) => {
      const idempotencyKey = crypto.randomUUID();
      return sprintsHttp.create(workspaceSlug, projectSlug, values, idempotencyKey);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: sprintKeys.all(workspaceSlug, projectSlug),
      });
      form.reset({ name: '', goal: undefined, startDate: '', endDate: '' });
      onOpenChange(false);
      toast.success('Sprint created');
    },
    onError: (err) => {
      const message =
        err instanceof HttpError ? (err.detail ?? err.title ?? err.message) : 'Create failed';
      toast.error(message);
    },
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sprint</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="sprint-name">Name</Label>
            <Input id="sprint-name" {...form.register('name')} autoFocus />
            {errors.name ? (
              <span className="text-xs text-destructive">{errors.name.message}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="sprint-goal">Goal (optional)</Label>
            <Input id="sprint-goal" {...form.register('goal')} />
            {errors.goal ? (
              <span className="text-xs text-destructive">{errors.goal.message}</span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sprint-start">Start date</Label>
              <Input id="sprint-start" type="date" {...form.register('startDate')} />
              {errors.startDate ? (
                <span className="text-xs text-destructive">{errors.startDate.message}</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sprint-end">End date</Label>
              <Input id="sprint-end" type="date" {...form.register('endDate')} />
              {errors.endDate ? (
                <span className="text-xs text-destructive">{errors.endDate.message}</span>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="sprint-create-submit">
              {mutation.isPending ? 'Creating…' : 'Create sprint'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
