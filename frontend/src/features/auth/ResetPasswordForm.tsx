'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ResetPasswordSchema, type ResetPasswordInput } from './schemas';
import { browserHttp } from '@/lib/http/browser';
import { useProblemMessage } from './useProblemMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations('auth.resetPassword');
  const tValidation = useTranslations('auth.validation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const messageForError = useProblemMessage();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const submitting = isSubmitting || isPending;

  function onSubmit(values: ResetPasswordInput) {
    startTransition(async () => {
      try {
        await browserHttp.post('/auth/password/reset/confirm', {
          token: values.token,
          password: values.password,
        });
        toast.success(t('success'));
        router.replace('/login');
      } catch (error) {
        toast.error(messageForError(error, 'resetFailed'));
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <input type="hidden" {...register('token')} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">{t('passwordLabel')}</Label>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'reset-password-error' : undefined}
          {...register('password')}
        />
        {errors.password ? (
          <p id="reset-password-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.password.message ?? 'password.min')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-confirm">{t('confirmLabel')}</Label>
        <Input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? 'reset-confirm-error' : undefined}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword ? (
          <p id="reset-confirm-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.confirmPassword.message ?? 'password.mismatch')}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={submitting} className="h-11">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
