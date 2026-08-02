'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Small always-visible marker that distinguishes AI-generated content from
 * human-authored content. Both an icon (`Sparkles`) and a text label are
 * present so color is not the only visual signal (WCAG 1.4.1 non-text
 * contrast + 1.3.3 sensory characteristics).
 */
export function AiOutputBadge({
  className,
  label = 'AI-generated',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary',
        className,
      )}
      role="note"
      aria-label={label}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
