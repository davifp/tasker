'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HttpError } from '@/lib/http/errors';
import { useCreateProject } from '@/features/projects/hooks/useCreateProject';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import {
  CreateProjectSchema,
  PROJECT_COLORS,
  PROJECT_ICONS,
  slugifyProjectName,
  type CreateProjectInput,
} from './schemas';
import { ProjectIcon } from './ProjectIcon';
import { cn } from '@/lib/utils';

interface CreateProjectDialogProps {
  workspaceSlug: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function CreateProjectDialog({
  workspaceSlug,
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const t = useTranslations('projects.create');
  const tValidation = useTranslations('projects.validation');
  const router = useRouter();
  const emit = useAnalytics();
  const createProject = useCreateProject(workspaceSlug);

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      name: '',
      slug: '',
      color: PROJECT_COLORS[0],
      icon: PROJECT_ICONS[0],
      description: '',
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const name = watch('name');
  const slug = watch('slug');
  const color = watch('color');
  const icon = watch('icon');
  const derivedSlug = useMemo(() => slugifyProjectName(name ?? ''), [name]);

  // Once the user edits the slug field themselves, we stop auto-deriving
  // from the name — even if they later clear the slug. The ref flips true
  // the moment their input diverges from the derived value.
  const slugEdited = useRef(false);
  useEffect(() => {
    if (slug && slug !== derivedSlug) {
      slugEdited.current = true;
    }
  }, [slug, derivedSlug]);

  useEffect(() => {
    if (!slugEdited.current && derivedSlug) {
      setValue('slug', derivedSlug, { shouldValidate: false });
    }
  }, [derivedSlug, setValue]);

  useEffect(() => {
    if (!open) {
      slugEdited.current = false;
      reset({
        name: '',
        slug: '',
        color: PROJECT_COLORS[0],
        icon: PROJECT_ICONS[0],
        description: '',
      });
    }
  }, [open, reset]);

  async function onSubmit(values: CreateProjectInput) {
    try {
      const created = await createProject.mutateAsync({
        name: values.name,
        slug: values.slug,
        color: values.color,
        icon: values.icon,
        description: values.description || undefined,
      });
      emit({
        name: 'project_created',
        workspaceId: created.workspaceId,
        projectId: created.id,
      });
      toast.success(t('success'));
      onOpenChange(false);
      router.push(`/${workspaceSlug}/projects/${created.slug}/board`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        toast.error(t('slugTaken'));
      } else {
        toast.error(t('failed'));
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">{t('nameLabel')}</Label>
            <Input
              id="project-name"
              autoFocus
              placeholder={t('namePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'project-name-error' : undefined}
              {...register('name')}
            />
            {errors.name ? (
              <p id="project-name-error" role="alert" className="text-sm text-destructive">
                {tValidation(errors.name.message ?? 'name.min')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-slug">{t('slugLabel')}</Label>
            <Input
              id="project-slug"
              aria-invalid={Boolean(errors.slug)}
              aria-describedby={errors.slug ? 'project-slug-error' : 'project-slug-hint'}
              {...register('slug')}
            />
            <p id="project-slug-hint" className="text-xs text-muted-foreground">
              {t('slugHint')}
            </p>
            {errors.slug ? (
              <p id="project-slug-error" role="alert" className="text-sm text-destructive">
                {tValidation(errors.slug.message ?? 'slug.format')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('colorLabel')}</Label>
            <div role="radiogroup" aria-label={t('colorLabel')} className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={color === swatch}
                  aria-label={swatch}
                  onClick={() => setValue('color', swatch, { shouldValidate: true })}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    color === swatch
                      ? 'scale-110 border-foreground'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
            {errors.color ? (
              <p role="alert" className="text-sm text-destructive">
                {tValidation(errors.color.message ?? 'color.format')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('iconLabel')}</Label>
            <div role="radiogroup" aria-label={t('iconLabel')} className="flex flex-wrap gap-2">
              {PROJECT_ICONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={icon === option}
                  aria-label={option}
                  onClick={() => setValue('icon', option, { shouldValidate: true })}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    icon === option
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-foreground/40',
                  )}
                >
                  <ProjectIcon name={option} className="h-4 w-4" />
                </button>
              ))}
            </div>
            {errors.icon ? (
              <p role="alert" className="text-sm text-destructive">
                {tValidation(errors.icon.message ?? 'icon.required')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">{t('descriptionLabel')}</Label>
            <textarea
              id="project-description"
              rows={3}
              maxLength={500}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-describedby="project-description-hint"
              {...register('description')}
            />
            <p id="project-description-hint" className="text-xs text-muted-foreground">
              {t('descriptionHint')}
            </p>
            {errors.description ? (
              <p role="alert" className="text-sm text-destructive">
                {tValidation(errors.description.message ?? 'description.max')}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
