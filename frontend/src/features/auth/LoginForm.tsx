'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { LoginSchema, type LoginInput } from './schemas';
import { bff } from '@/lib/http/bff';
import { useProblemMessage } from './useProblemMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginResponse {
  userId: string;
}

function safeRedirectTarget(candidate: string | null): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}

export function LoginForm() {
  const t = useTranslations('auth.login');
  const tValidation = useTranslations('auth.validation');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const messageForError = useProblemMessage();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submitting = isSubmitting || isPending;

  function onSubmit(values: LoginInput) {
    startTransition(async () => {
      try {
        await bff.post<LoginResponse>('/auth/login', values);
        const redirectTo = safeRedirectTarget(searchParams.get('redirectTo'));
        router.replace(redirectTo);
        router.refresh();
      } catch (error) {
        toast.error(messageForError(error, 'signInFailed'));
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">{t('emailLabel')}</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          {...register('email')}
        />
        {errors.email ? (
          <p id="login-email-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.email.message ?? 'email.invalid')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">{t('passwordLabel')}</Label>
          <Link
            href="/forgot-password"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('forgotPassword')}
          </Link>
        </div>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'login-password-error' : undefined}
          {...register('password')}
        />
        {errors.password ? (
          <p id="login-password-error" role="alert" className="text-sm text-destructive">
            {tValidation(errors.password.message ?? 'password.required')}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={submitting} className="h-11">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
