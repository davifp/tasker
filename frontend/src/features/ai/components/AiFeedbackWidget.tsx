'use client';

import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HttpError } from '@/lib/http/errors';
import { useSubmitAiFeedback } from '../hooks/useAiActions';

interface AiFeedbackWidgetProps {
  workspaceSlug: string;
  invocationId: string;
  className?: string;
}

/**
 * Compact 👍 / 👎 pair with an optional free-text reason on downvote.
 * The reason input only appears after 👎; the primary rating is a single
 * click. Duplicate submissions (backend enforces `(invocationId, userId)`
 * unique) surface as an inline "already rated" note rather than a scary
 * toast.
 */
export function AiFeedbackWidget({
  workspaceSlug,
  invocationId,
  className,
}: AiFeedbackWidgetProps) {
  const [submitted, setSubmitted] = useState<'POSITIVE' | 'NEGATIVE' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const submit = useSubmitAiFeedback(workspaceSlug);

  async function send(rating: 'POSITIVE' | 'NEGATIVE') {
    try {
      await submit.mutateAsync({
        invocationId,
        rating,
        reason: rating === 'NEGATIVE' ? reason || undefined : undefined,
      });
      setSubmitted(rating);
      setReasonOpen(false);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setSubmitted(rating); // already rated — treat as submitted for UX
      } else {
        toast.error(err instanceof HttpError ? err.title : 'Could not submit feedback');
      }
    }
  }

  if (submitted) {
    return (
      <p className={className} role="status" aria-live="polite">
        Thanks for the feedback.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1" role="group" aria-label="Rate this AI response">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Rate this AI response positively"
          onClick={() => send('POSITIVE')}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Rate this AI response negatively"
          onClick={() => setReasonOpen((v) => !v)}
        >
          <ThumbsDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {reasonOpen ? (
        <div className="mt-2 flex flex-col gap-2">
          <label
            htmlFor={`ai-feedback-reason-${invocationId}`}
            className="text-xs text-muted-foreground"
          >
            What was wrong? (optional)
          </label>
          <textarea
            id={`ai-feedback-reason-${invocationId}`}
            className="min-h-16 rounded border p-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => send('NEGATIVE')}>
              Send feedback
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReasonOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
