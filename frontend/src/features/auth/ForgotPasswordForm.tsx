'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ForgotPasswordSchema, type ForgotPasswordInput } from './schemas';
import { browserHttp } from '@/lib/http/browser';
import { useProblemMessage } from './useProblemMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword');
  const tValidation = useTranslations('auth.validation');
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const messageForError = useProblemMessage();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const submitting = isSubmitting || isPending;

  function onSubmit(values: ForgotPasswordInput) {
    startTransition(async () => {
      try {
        await browserHttp.post('/auth/password/reset/request', values);
      } catch (error) {
        // Never disclose whether an email is registered; only surface
        // errors that clearly indicate a client mistake (400 range).
        const message = messageForError(error, 'unknown');
        toast.error(message);
      } finally {
        setSubmitted(true);
      }
    });
  }

  if (submitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-border bg-muted p-4"
      >
        <p className="text-sm text-foreground">{t('neutralSuccess')}</p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">{t('emailLabel')}</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'forgot-email-error' : undefined}
          {...register('email')}
        />
        {errors.email ? (
          <p id="forgot-email-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.email.message ?? 'email.invalid')}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={submitting} className="h-11">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
