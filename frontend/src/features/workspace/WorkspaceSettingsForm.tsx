'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { WorkspaceSettingsSchema, type WorkspaceSettingsInput } from './schemas';
import { browserHttp } from '@/lib/http/browser';
import { HttpError } from '@/lib/http/errors';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface WorkspaceSettingsFormProps {
  slug: string;
  name: string;
  canEdit: boolean;
}

export function WorkspaceSettingsForm({ slug, name, canEdit }: WorkspaceSettingsFormProps) {
  const t = useTranslations('workspace.settings');
  const tValidation = useTranslations('workspace.validation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingSubmit, setPendingSubmit] = useState<WorkspaceSettingsInput | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<WorkspaceSettingsInput>({
    resolver: zodResolver(WorkspaceSettingsSchema),
    defaultValues: { name, slug },
  });

  const submitting = isSubmitting || isPending;

  function performSave(values: WorkspaceSettingsInput) {
    startTransition(async () => {
      try {
        await browserHttp.patch(`/workspaces/${encodeURIComponent(slug)}`, values);
        toast.success(t('saved'));
        if (values.slug !== slug) {
          router.replace(`/${values.slug}/settings`);
        }
        router.refresh();
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          toast.error(t('slugTaken'));
        } else {
          toast.error(t('failed'));
        }
      } finally {
        setPendingSubmit(null);
      }
    });
  }

  function onSubmit(values: WorkspaceSettingsInput) {
    if (values.slug !== slug) {
      setPendingSubmit(values);
      return;
    }
    performSave(values);
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
        aria-disabled={!canEdit}
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-name">{t('nameLabel')}</Label>
          <Input
            id="settings-name"
            disabled={!canEdit}
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
          {errors.name ? (
            <p role="alert" className="text-sm text-destructive">
              {tValidation(errors.name.message ?? 'name.min')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-slug">{t('slugLabel')}</Label>
          <Input
            id="settings-slug"
            disabled={!canEdit}
            aria-invalid={Boolean(errors.slug)}
            {...register('slug')}
          />
          {errors.slug ? (
            <p role="alert" className="text-sm text-destructive">
              {tValidation(errors.slug.message ?? 'slug.format')}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <Button type="submit" disabled={submitting || !isDirty} className="self-start">
            {submitting ? t('saving') : t('save')}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
        )}
      </form>
      <AlertDialog
        open={pendingSubmit !== null}
        onOpenChange={(open) => (!open ? setPendingSubmit(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('slugWarningTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('slugWarningBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSubmit) performSave(pendingSubmit);
              }}
            >
              {t('confirmSlugChange')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
