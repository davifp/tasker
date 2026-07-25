'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { REACTIONS_CATALOG, REACTIONS_GLYPHS, type ReactionEmoji } from '@tasker/config';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ReactionSummary } from '@/lib/http/types';

interface ReactionBarProps {
  /** Summary rows from GET /reactions — keyed by emoji, at most one per key. */
  summaries: ReactionSummary[];
  onToggle: (emoji: ReactionEmoji) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Fixed 8-emoji strip with per-emoji count + reactor tooltip. Emojis outside
 * `REACTIONS_CATALOG` are never rendered — a catalog trim removes them from
 * the UI even if historical rows remain in the DB.
 *
 * Idempotent from the user's perspective: clicking an emoji the user already
 * reacted with removes their reaction; a click on a fresh emoji adds it.
 * The parent hook computes both add/remove paths from `reactedByMe`.
 */
export function ReactionBar({ summaries, onToggle, disabled, className }: ReactionBarProps) {
  const t = useTranslations('board.reactions');
  const bySlug = useMemo(() => {
    const map = new Map<string, ReactionSummary>();
    for (const summary of summaries) map.set(summary.emoji, summary);
    return map;
  }, [summaries]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn('flex flex-wrap gap-1', className)} aria-label={t('label')}>
        {REACTIONS_CATALOG.map((emoji) => {
          const summary = bySlug.get(emoji);
          const count = summary?.count ?? 0;
          const active = summary?.reactedByMe ?? false;
          const glyph = REACTIONS_GLYPHS[emoji];
          const label = t(`emoji.${emoji}`);
          return (
            <Tooltip key={emoji}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(emoji)}
                  aria-label={label}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-6 min-w-[2rem] items-center justify-center gap-0.5 rounded-full border px-1.5 text-xs',
                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground/70 hover:border-primary/30 hover:text-foreground',
                    disabled && 'opacity-60',
                  )}
                >
                  <span aria-hidden="true">{glyph}</span>
                  {count > 0 ? <span className="tabular-nums">{count}</span> : null}
                </button>
              </TooltipTrigger>
              {summary && summary.count > 0 ? (
                <TooltipContent side="top" className="max-w-xs text-xs">
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground">
                    {summary.reactorSample.map((r) => r.displayName).join(', ')}
                    {summary.count > summary.reactorSample.length
                      ? ` +${summary.count - summary.reactorSample.length}`
                      : null}
                  </p>
                </TooltipContent>
              ) : null}
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
