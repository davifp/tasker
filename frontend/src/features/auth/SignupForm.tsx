'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SignupSchema, type SignupInput } from './schemas';
import { bff } from '@/lib/http/bff';
import { useProblemMessage } from './useProblemMessage';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RegisterResponse {
  userId: string;
}

export function SignupForm() {
  const t = useTranslations('auth.signup');
  const tValidation = useTranslations('auth.validation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const messageForError = useProblemMessage();
  const emit = useAnalytics();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const submitting = isSubmitting || isPending;
  const password = watch('password') ?? '';

  function onSubmit(values: SignupInput) {
    startTransition(async () => {
      try {
        emit({ name: 'signup_started', provider: 'local' });
        await bff.post<RegisterResponse>('/auth/register', values);
        emit({ name: 'signup_completed', provider: 'local' });
        router.replace('/verify-email');
        router.refresh();
      } catch (error) {
        toast.error(messageForError(error, 'signUpFailed'));
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-name">{t('nameLabel')}</Label>
        <Input
          id="signup-name"
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'signup-name-error' : undefined}
          {...register('name')}
        />
        {errors.name ? (
          <p id="signup-name-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.name.message ?? 'name.required')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email">{t('emailLabel')}</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'signup-email-error' : undefined}
          {...register('email')}
        />
        {errors.email ? (
          <p id="signup-email-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.email.message ?? 'email.invalid')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password">{t('passwordLabel')}</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={
            errors.password
              ? 'signup-password-error signup-password-strength'
              : 'signup-password-strength'
          }
          {...register('password')}
        />
        <PasswordStrengthMeter id="signup-password-strength" value={password} />
        {errors.password ? (
          <p id="signup-password-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.password.message ?? 'password.min')}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={submitting} className="h-11">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
