'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { InviteBatchSchema, type InviteBatchInput } from './schemas';
import { browserHttp } from '@/lib/http/browser';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface InvitePeopleDialogProps {
  slug: string;
  workspaceId?: string;
}

export function InvitePeopleDialog({ slug, workspaceId }: InvitePeopleDialogProps) {
  const t = useTranslations('members.invite');
  const emit = useAnalytics();
  const tValidation = useTranslations('members.validation');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteBatchInput>({
    resolver: zodResolver(InviteBatchSchema),
    defaultValues: { invites: [{ email: '', role: 'MEMBER' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'invites' });

  function onSubmit(values: InviteBatchInput) {
    startTransition(async () => {
      try {
        await browserHttp.post(
          `/workspaces/${encodeURIComponent(slug)}/invitations`,
          values.invites,
        );
        if (workspaceId) {
          emit({ name: 'invite_sent', workspaceId, count: values.invites.length });
        }
        toast.success(t('success', { count: values.invites.length }));
        reset({ invites: [{ email: '', role: 'MEMBER' }] });
        setOpen(false);
        router.refresh();
      } catch {
        toast.error(t('failed'));
      }
    });
  }

  const submitting = isSubmitting || isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="self-start">{t('trigger')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-3">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor={`invite-email-${index}`}>{t('emailLabel')}</Label>
                  <Input
                    id={`invite-email-${index}`}
                    type="email"
                    autoComplete="email"
                    aria-invalid={Boolean(errors.invites?.[index]?.email)}
                    {...register(`invites.${index}.email`)}
                  />
                  {errors.invites?.[index]?.email ? (
                    <p role="alert" className="text-xs text-destructive">
                      {tValidation(errors.invites[index]!.email!.message ?? 'email.invalid')}
                    </p>
                  ) : null}
                </div>
                <div className="flex w-40 flex-col gap-1.5">
                  <Label htmlFor={`invite-role-${index}`}>{t('roleLabel')}</Label>
                  <select
                    id={`invite-role-${index}`}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                    {...register(`invites.${index}.role`)}
                  >
                    <option value="ADMIN">{t('roles.ADMIN')}</option>
                    <option value="MEMBER">{t('roles.MEMBER')}</option>
                    <option value="GUEST">{t('roles.GUEST')}</option>
                  </select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                  aria-label={t('removeRow')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ email: '', role: 'MEMBER' })}
            disabled={fields.length >= 10}
            className="self-start"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addRow')}
          </Button>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
