'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CreateWorkspaceSchema, type CreateWorkspaceInput, slugify } from './schemas';
import { browserHttp } from '@/lib/http/browser';
import { HttpError } from '@/lib/http/errors';
import { bff } from '@/lib/http/bff';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface WorkspaceCreatedResponse {
  id: string;
  slug: string;
  name: string;
}

async function checkSlug(slug: string, signal: AbortSignal): Promise<boolean> {
  try {
    await browserHttp.get(`/workspaces/${encodeURIComponent(slug)}`, { signal });
    return false;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return true;
    throw error;
  }
}

type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error' };

export function CreateWorkspaceForm() {
  const t = useTranslations('workspace.create');
  const tValidation = useTranslations('workspace.validation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' });
  const emit = useAnalytics();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(CreateWorkspaceSchema),
    defaultValues: { name: '', slug: '' },
  });

  const name = watch('name');
  const slug = watch('slug');

  const derivedSlug = useMemo(() => slugify(name ?? ''), [name]);

  useEffect(() => {
    if (!slug && derivedSlug) {
      setValue('slug', derivedSlug, { shouldValidate: false });
    }
  }, [derivedSlug, slug, setValue]);

  useEffect(() => {
    const parsed = CreateWorkspaceSchema.shape.slug.safeParse(slug);
    if (!parsed.success) {
      setSlugState({ kind: 'idle' });
      return;
    }
    setSlugState({ kind: 'checking' });
    const controller = new AbortController();
    const handle = setTimeout(() => {
      checkSlug(parsed.data, controller.signal)
        .then((available) => setSlugState({ kind: available ? 'available' : 'taken' }))
        .catch(() => setSlugState({ kind: 'error' }));
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [slug]);

  const submitting = isPending || isSubmitting;

  function onSubmit(values: CreateWorkspaceInput) {
    startTransition(async () => {
      try {
        const created = await browserHttp.post<WorkspaceCreatedResponse>('/workspaces', values);
        emit({ name: 'workspace_created', workspaceId: created.id });
        await bff.post('/workspaces/select', { slug: created.slug }).catch(() => undefined);
        toast.success(t('success'));
        router.replace(`/${created.slug}/projects`);
        router.refresh();
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          setSlugState({ kind: 'taken' });
          toast.error(t('slugTaken'));
        } else {
          toast.error(t('failed'));
        }
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workspace-name">{t('nameLabel')}</Label>
        <Input
          id="workspace-name"
          autoFocus
          autoComplete="organization"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'workspace-name-error' : undefined}
          {...register('name')}
        />
        {errors.name ? (
          <p id="workspace-name-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.name.message ?? 'name.min')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workspace-slug">{t('slugLabel')}</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">tasker.dev/</span>
          <Input
            id="workspace-slug"
            aria-invalid={Boolean(errors.slug) || slugState.kind === 'taken'}
            aria-describedby={
              errors.slug || slugState.kind !== 'idle' ? 'workspace-slug-hint' : undefined
            }
            {...register('slug')}
          />
        </div>
        <p id="workspace-slug-hint" className="text-xs text-muted-foreground">
          {slugState.kind === 'checking' && t('slugChecking')}
          {slugState.kind === 'available' && (
            <span className="text-emerald-600">{t('slugAvailable')}</span>
          )}
          {slugState.kind === 'taken' && <span className="text-destructive">{t('slugTaken')}</span>}
          {slugState.kind === 'idle' && t('slugHint')}
          {slugState.kind === 'error' && t('slugCheckError')}
        </p>
        {errors.slug ? (
          <p role="alert" className="text-sm text-destructive">
            {tValidation(errors.slug.message ?? 'slug.format')}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={submitting || slugState.kind === 'taken'} className="h-11">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
