'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { epicsHttp, type Epic } from '@/lib/http/epics';
import { epicKeys } from '@/features/queryKeys';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { toastFromError } from '@/lib/errors/toastFromError';

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
  const workspaceScoped = !editing && projectSlug === '';
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

  const projectsQuery = useProjects(workspaceSlug, { status: 'ACTIVE' });
  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data]);
  const [selectedProjectSlug, setSelectedProjectSlug] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    if (workspaceScoped && projects.length > 0 && !selectedProjectSlug) {
      setSelectedProjectSlug(projects[0]!.slug);
    }
  }, [open, workspaceScoped, projects, selectedProjectSlug]);

  const [projectError, setProjectError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (values: CreateEpicInput) => {
      if (editing && epic) {
        return epicsHttp.update(workspaceSlug, epic.id, values);
      }
      const targetSlug = workspaceScoped ? selectedProjectSlug : projectSlug;
      const idempotencyKey = crypto.randomUUID();
      return epicsHttp.create(workspaceSlug, targetSlug, values, idempotencyKey);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: epicKeys.all(workspaceSlug) });
      onOpenChange(false);
      toast.success(editing ? 'Epic updated' : 'Epic created');
    },
    onError: (err) => {
      toastFromError(err, editing ? 'Save failed' : 'Create failed');
    },
  });

  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    if (workspaceScoped && !selectedProjectSlug) {
      setProjectError('Pick a project to create this epic in');
      return;
    }
    setProjectError(null);
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit epic' : 'New epic'}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          {workspaceScoped ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="epic-project">Project</Label>
              <select
                id="epic-project"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedProjectSlug}
                onChange={(event) => {
                  setSelectedProjectSlug(event.target.value);
                  if (event.target.value) setProjectError(null);
                }}
                disabled={projectsQuery.isLoading || projects.length === 0}
              >
                {projectsQuery.isLoading ? (
                  <option value="">Loading projects…</option>
                ) : projects.length === 0 ? (
                  <option value="">No active projects — create one first</option>
                ) : (
                  <>
                    <option value="">Select a project…</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.slug}>
                        {project.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {projectError ? <p className="text-xs text-destructive">{projectError}</p> : null}
            </div>
          ) : null}
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
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                (workspaceScoped && (projectsQuery.isLoading || projects.length === 0))
              }
            >
              {mutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
