'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { commentBodySchema } from '@tasker/config';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MentionSuggestion } from '@/lib/http/types';
import { SafeMarkdown } from '@/components/markdown/SafeMarkdown';
import { MentionPopover } from './mentions/MentionPopover';

interface MarkdownComposerProps {
  workspaceSlug: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  className?: string;
  /**
   * Optional map of resolved handles → user info, used by the preview to
   * render mentions as pills. Callers typically pass the last-known mention
   * set from the comment being edited or the local suggestion cache.
   */
  mentionMap?: Readonly<Record<string, { userId: string; displayName?: string }>>;
}

type MentionState = { start: number; end: number; anchor: { top: number; left: number } } | null;

const MAX_LEN = commentBodySchema.maxLength ?? 10_000;

/**
 * Textarea + Markdown preview toggle + @mention popover trigger.
 *
 * Mention triggering: when the caret sits immediately after a `@` that has
 * a valid pre-anchor character (start-of-string / whitespace / `(`), the
 * popover opens with the running handle as its query. The parent (backend)
 * still does authoritative resolution — this only surfaces suggestions.
 *
 * The popover is a plain positioned menu (see MentionPopover.tsx for why
 * we did not use @radix-ui/react-popover). Positioning uses a caret
 * measurement trick: we render an invisible mirror div, sync its content
 * up to the caret, then read the position of a marker `<span>`.
 */
export function MarkdownComposer({
  workspaceSlug,
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  isSubmitting,
  className,
  mentionMap,
}: MarkdownComposerProps) {
  const t = useTranslations('board.composer');
  const [showPreview, setShowPreview] = useState(false);
  const [mention, setMention] = useState<MentionState>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeQuery = useMemo(() => {
    if (!mention) return '';
    return value.slice(mention.start + 1, mention.end);
  }, [value, mention]);

  const scanForMentionTrigger = useCallback((next: string, caret: number) => {
    // Walk back from the caret to find the nearest '@' with a valid anchor.
    let i = caret - 1;
    while (i >= 0) {
      const ch = next.charAt(i);
      if (ch === '@') {
        const prev = i > 0 ? next.charAt(i - 1) : '';
        const validAnchor = i === 0 || /\s|\(|>/.test(prev);
        if (!validAnchor) return null;
        const handle = next.slice(i + 1, caret);
        if (!/^[a-zA-Z0-9._-]{0,64}$/.test(handle)) return null;
        const anchor = readCaretPosition(textareaRef.current, i);
        if (!anchor) return null;
        return { start: i, end: caret, anchor };
      }
      // Break on whitespace / newline / punctuation that ends a handle.
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value.slice(0, MAX_LEN);
      const caret = event.target.selectionStart ?? next.length;
      onChange(next);
      setMention(scanForMentionTrigger(next, caret));
    },
    [onChange, scanForMentionTrigger],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isSubmitting) {
        event.preventDefault();
        onSubmit();
      }
    },
    [onSubmit, isSubmitting],
  );

  const handleMentionPick = useCallback(
    (suggestion: MentionSuggestion | null) => {
      if (!mention || !suggestion) {
        setMention(null);
        return;
      }
      const before = value.slice(0, mention.start);
      const after = value.slice(mention.end);
      const insert = `@${suggestion.slug} `;
      const next = `${before}${insert}${after}`.slice(0, MAX_LEN);
      onChange(next);
      setMention(null);
      // Return focus + place the caret after the inserted mention.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const caret = before.length + insert.length;
        el.setSelectionRange(caret, caret);
      });
    },
    [value, mention, onChange],
  );

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <div className="flex gap-1 text-xs">
          {/*
           * Active tab uses foreground text + a bottom border rather than
           * a filled accent background: bg-accent/text-accent-foreground
           * (white on emerald-600) only clears 3.86:1, below WCAG AA 4.5:1.
           * Foreground text on the panel bg is well above 4.5:1 and the
           * bottom border still signals the active state.
           */}
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className={cn(
              'rounded px-2 py-0.5 border-b-2',
              !showPreview
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={!showPreview}
          >
            {t('write')}
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={cn(
              'rounded px-2 py-0.5 border-b-2',
              showPreview
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={showPreview}
          >
            {t('preview')}
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {value.length}/{MAX_LEN}
        </span>
      </div>

      {showPreview ? (
        <div className="min-h-[6rem] rounded-md border border-border bg-background p-2">
          {value.trim().length > 0 ? (
            <SafeMarkdown source={value} mentionMap={mentionMap} />
          ) : (
            <p className="text-xs text-muted-foreground">{t('previewEmpty')}</p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="w-full rounded-md border border-border bg-background p-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t('placeholder')}
          maxLength={MAX_LEN}
          aria-label={t('label')}
          rows={3}
        />
      )}

      {onSubmit ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={isSubmitting || value.trim().length === 0}
          >
            {isSubmitting ? t('submitting') : (submitLabel ?? t('submit'))}
          </Button>
        </div>
      ) : null}

      <MentionPopover
        workspaceSlug={workspaceSlug}
        query={activeQuery}
        anchor={mention?.anchor ?? null}
        onPick={handleMentionPick}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caret positioning: renders a mirror div matching the textarea's font/box
// metrics, syncs its content up to the given offset, and reads the bounding
// rect of a marker span placed at the caret. Cheap enough to run on each
// keystroke (no layout thrash — the mirror is measured then removed).
// ---------------------------------------------------------------------------

const MIRRORED_STYLE_PROPS = [
  'boxSizing',
  'width',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

function readCaretPosition(
  textarea: HTMLTextAreaElement | null,
  offset: number,
): { top: number; left: number } | null {
  if (typeof window === 'undefined' || !textarea) return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const mirrorStyle = mirror.style as unknown as Record<string, string>;
  const sourceStyle = style as unknown as Record<string, string>;
  for (const prop of MIRRORED_STYLE_PROPS) {
    mirrorStyle[prop] = sourceStyle[prop] ?? '';
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = '@';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const taRect = textarea.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: taRect.top + (markerRect.top - mirrorRect.top) + markerRect.height - textarea.scrollTop,
    left: taRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft,
  };
}
