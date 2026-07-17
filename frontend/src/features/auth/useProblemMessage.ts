'use client';

import { useTranslations } from 'next-intl';
import { HttpError } from '@/lib/http/errors';

export function useProblemMessage(): (error: unknown, fallbackKey?: string) => string {
  const t = useTranslations('auth.errors');
  const tCommon = useTranslations('common.errors');

  return (error, fallbackKey = 'unknown') => {
    if (error instanceof HttpError) {
      const key = error.type?.split('/').pop();
      if (key) {
        try {
          return t(key);
        } catch {
          // fall through
        }
      }
      if (error.title) return error.title;
    }
    if (error instanceof Error && error.message) return error.message;
    try {
      return tCommon(fallbackKey);
    } catch {
      return 'Something went wrong.';
    }
  };
}
