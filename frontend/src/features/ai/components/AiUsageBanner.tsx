'use client';

import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiUsageSnapshot } from '@/lib/http/ai';

interface AiUsageBannerProps {
  usage: AiUsageSnapshot | undefined;
  isAdmin: boolean;
  onAcceptConsent?: () => void;
  className?: string;
}

/**
 * Banner shown near the AI actions surface. Three states:
 *
 *  - Consent missing (non-admin) → "Admin must enable AI".
 *  - Consent missing (admin)      → "Accept the AI consent to enable".
 *  - Budget ≥ 100%                → "Monthly limit reached".
 *  - Budget ≥ 80%                 → "Approaching monthly limit".
 *
 * When none of those apply the component renders nothing.
 */
export function AiUsageBanner({ usage, isAdmin, onAcceptConsent, className }: AiUsageBannerProps) {
  if (!usage) return null;

  const consent = usage.consent;
  if (!consent.accepted) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100',
          className,
        )}
        role="status"
      >
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1">
          {isAdmin ? (
            <>
              <p className="font-medium">Enable AI actions for this workspace.</p>
              <p className="mt-1">
                Task/comment content will be sent to the AI provider. You can revoke by rotating the
                consent document.
              </p>
              {onAcceptConsent ? (
                <button
                  type="button"
                  onClick={onAcceptConsent}
                  className="mt-2 inline-flex items-center rounded-md bg-amber-900 px-2 py-1 text-xs font-medium text-amber-50 hover:bg-amber-950"
                >
                  Accept and enable
                </button>
              ) : null}
            </>
          ) : (
            <p>
              <span className="font-medium">Admin must enable AI</span> before these actions become
              available in this workspace.
            </p>
          )}
        </div>
      </div>
    );
  }

  const consumed = usage.tokensConsumed;
  const budget = usage.tokensBudget;
  const ratio = budget > 0 ? consumed / budget : 0;

  if (ratio >= 1) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-100',
          className,
        )}
        role="alert"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">Monthly limit reached.</span> AI actions will resume next
          billing cycle ({usage.billingMonth}).
        </p>
      </div>
    );
  }

  if (ratio >= 0.8) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-500/50 dark:bg-yellow-500/10 dark:text-yellow-100',
          className,
        )}
        role="status"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">Approaching monthly limit</span> — {Math.round(ratio * 100)}
          % of {budget.toLocaleString()} tokens used.
        </p>
      </div>
    );
  }

  return null;
}
