'use client';

import { useTranslations } from 'next-intl';
import { scorePassword } from './schemas';

const LEVELS = [
  { key: 'veryWeak', className: 'bg-destructive' },
  { key: 'weak', className: 'bg-destructive' },
  { key: 'fair', className: 'bg-amber-500' },
  { key: 'good', className: 'bg-amber-500' },
  { key: 'strong', className: 'bg-emerald-500' },
  { key: 'excellent', className: 'bg-emerald-600' },
] as const;

interface PasswordStrengthMeterProps {
  value: string;
  id?: string;
}

export function PasswordStrengthMeter({ value, id }: PasswordStrengthMeterProps) {
  const t = useTranslations('auth.passwordStrength');
  const score = scorePassword(value);
  const level = LEVELS[score] ?? LEVELS[0];

  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex flex-col gap-1.5"
      data-strength-score={score}
    >
      <div className="flex gap-1" aria-hidden="true">
        {LEVELS.slice(1).map((entry, index) => (
          <span
            key={entry.key}
            className={`h-1 flex-1 rounded ${index < score ? level.className : 'bg-muted'}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('label')}: <span className="font-medium text-foreground">{t(level.key)}</span>
      </p>
    </div>
  );
}
