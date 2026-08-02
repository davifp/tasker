'use client';

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/markdown/SafeMarkdown';
import type { HttpError } from '@/lib/http/errors';
import { AiOutputBadge } from './AiOutputBadge';
import type { AiUsageSnapshot } from '@/lib/http/ai';
import { useSummarizeThread } from '../hooks/useAiActions';

const MIN_COMMENTS_FOR_SUMMARY = 10;

interface SummarizeThreadButtonProps {
  workspaceSlug: string;
  taskId: string;
  commentCount: number;
  usage: AiUsageSnapshot | undefined;
  onPostAsComment?: (summary: string) => void;
  className?: string;
}

/**
 * Rendered above the comments list. Only appears when the thread crosses
 * `MIN_COMMENTS_FOR_SUMMARY`; below that, the affordance is not offered
 * (the tech spec's minimum-context guard). The summary renders in a
 * dismissible panel; the user may optionally post it as a comment.
 */
export function SummarizeThreadButton({
  workspaceSlug,
  taskId,
  commentCount,
  usage,
  onPostAsComment,
  className,
}: SummarizeThreadButtonProps) {
  const stream = useSummarizeThread(workspaceSlug, taskId);
  const [open, setOpen] = useState(false);

  if (commentCount < MIN_COMMENTS_FOR_SUMMARY) return null;

  const disabled = !usage || !usage.consent.accepted;

  async function run() {
    setOpen(true);
    await stream.start();
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={disabled || stream.status === 'streaming'}
        aria-label="Summarize this discussion with AI"
      >
        <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
        Summarize discussion
      </Button>
      {open ? (
        <section
          className="mt-2 rounded-md border bg-muted/30 p-3"
          role="region"
          aria-labelledby="summary-heading"
          aria-busy={stream.status === 'streaming'}
        >
          <header className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 id="summary-heading" className="text-sm font-medium">
                Discussion summary
              </h3>
              <AiOutputBadge />
            </div>
            <div className="flex items-center gap-1">
              {stream.status === 'done' && stream.text && onPostAsComment ? (
                <Button size="sm" variant="ghost" onClick={() => onPostAsComment(stream.text)}>
                  Post as comment
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setOpen(false)}
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </header>
          <div aria-live="polite">
            {stream.status === 'error' && stream.error ? (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {friendlyErrorMessage(stream.error)}
              </p>
            ) : stream.text ? (
              <SafeMarkdown source={stream.text} />
            ) : (
              <p className="text-sm italic text-muted-foreground">Working…</p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function friendlyErrorMessage(err: HttpError): string {
  if (err.type === 'about:blank#ai-insufficient-context') {
    return err.detail ?? 'Not enough context to summarize.';
  }
  return err.title;
}
