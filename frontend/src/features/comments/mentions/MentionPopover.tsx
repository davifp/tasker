'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { MentionSuggestion } from '@/lib/http/types';
import { useMentionSearch } from './useMentionSearch';

interface MentionPopoverProps {
  workspaceSlug: string;
  /** The active query — chars typed since the `@` trigger, excluding `@`. */
  query: string;
  /** Screen position (relative to viewport) where the popover should anchor. */
  anchor: { top: number; left: number } | null;
  /** Called with the picked suggestion or `null` if the popover is dismissed. */
  onPick: (suggestion: MentionSuggestion | null) => void;
  /** Optional cap on the number of results (matches the mention-search API). */
  limit?: number;
}

/**
 * Keyboard-navigable mention picker anchored to the caret of a
 * `MarkdownComposer`. Built as a plain positioned menu rather than
 * `@radix-ui/react-popover` because the anchor is the caret (not the trigger
 * element), which Radix's Popover cannot express without a custom anchor
 * ref. Focus stays on the composer — ArrowUp/Down + Enter drive selection.
 * Escape / clicking outside dismisses via `onPick(null)`.
 *
 * The parent owns the "should this be open" logic (caret is right after `@`
 * outside a code fence). This component only renders and drives selection.
 */
export function MentionPopover({
  workspaceSlug,
  query,
  anchor,
  onPick,
  limit,
}: MentionPopoverProps) {
  const t = useTranslations('board.mentions');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const open = anchor !== null;
  const { data, isLoading } = useMentionSearch({
    workspaceSlug,
    query,
    enabled: open,
    limit,
  });

  // Reset the highlighted row every time the query changes so keyboard focus
  // does not point past the trimmed list.
  useEffect(() => setActiveIndex(0), [query, data.length]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (data.length === 0 ? 0 : (i + 1) % data.length));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (data.length === 0 ? 0 : (i - 1 + data.length) % data.length));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (data.length === 0) return;
        event.preventDefault();
        onPick(data[activeIndex] ?? null);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onPick(null);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, data, activeIndex, onPick]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      const el = containerRef.current;
      if (el && !el.contains(event.target as Node)) onPick(null);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open, onPick]);

  if (!open || !anchor) return null;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('label')}
      className="fixed z-50 w-64 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {isLoading && data.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t('loading')}</div>
      ) : data.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t('empty')}</div>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1 text-sm">
          {data.map((item, index) => (
            <li key={item.userId}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left',
                  index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
                // Use mousedown so the composer's blur handler does not fire
                // first (which would close the popover before the click lands).
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(item);
                }}
              >
                <span className="truncate font-medium">{item.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">@{item.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
