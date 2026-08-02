'use client';

import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SafeMarkdown } from '@/components/markdown/SafeMarkdown';
import { HttpError } from '@/lib/http/errors';
import type { AiUsageSnapshot } from '@/lib/http/ai';
import { AiOutputBadge } from './AiOutputBadge';
import { AiFeedbackWidget } from './AiFeedbackWidget';
import { AiUsageBanner } from './AiUsageBanner';
import {
  useEstimateAndSuggest,
  useGenerateChecklist,
  useGenerateDescription,
} from '../hooks/useAiActions';

interface AiActionsMenuProps {
  workspaceSlug: string;
  taskId: string;
  taskTitle: string;
  projectName?: string;
  labelNames?: string[];
  usage: AiUsageSnapshot | undefined;
  isAdmin: boolean;
  onAcceptConsent?: () => void;
  onAcceptDescription: (draft: string) => void;
  onAcceptChecklist: (items: string[]) => void;
}

/**
 * Dropdown mounted in the task drawer header. Each action:
 *
 *  - Is disabled with a tooltip when consent is missing or the workspace's
 *    monthly budget is exhausted (a click still surfaces the reason for
 *    users on assistive tech).
 *  - Streams / calls the corresponding endpoint and renders the pending
 *    output inline with an AiOutputBadge; the user MUST press "Use" to
 *    persist the draft into the task fields.
 *
 * "Estimate & suggest" is not modeled here because its output lives beside
 * the estimate/priority/assignee fields — the drawer wires it separately.
 * This menu covers description and checklist.
 */
export function AiActionsMenu({
  workspaceSlug,
  taskId,
  taskTitle,
  projectName,
  labelNames,
  usage,
  isAdmin,
  onAcceptConsent,
  onAcceptDescription,
  onAcceptChecklist,
}: AiActionsMenuProps) {
  const description = useGenerateDescription(workspaceSlug, taskId);
  const checklist = useGenerateChecklist(workspaceSlug, taskId);
  const estimate = useEstimateAndSuggest(workspaceSlug, taskId);
  const [openPanel, setOpenPanel] = useState<'description' | 'checklist' | 'estimate' | null>(null);

  const disabled = disabledReason(usage);

  async function runDescription() {
    setOpenPanel('description');
    await description.start({ title: taskTitle, projectName, labels: labelNames });
  }

  async function runChecklist() {
    setOpenPanel('checklist');
    await checklist.start();
  }

  async function runEstimate() {
    setOpenPanel('estimate');
    try {
      await estimate.mutateAsync();
    } catch (err) {
      toast.error(err instanceof HttpError ? err.title : 'Suggestion failed');
    }
  }

  const checklistResult = checklist.result as { invocationId?: string; items?: string[] } | null;

  return (
    <div className="flex flex-col gap-3">
      <AiUsageBanner usage={usage} isAdmin={isAdmin} onAcceptConsent={onAcceptConsent} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(disabled)}
            aria-label="AI actions menu"
          >
            <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
            AI
            <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{disabled ?? 'AI-powered helpers'}</DropdownMenuLabel>
          <DropdownMenuItem disabled={Boolean(disabled)} onSelect={runDescription}>
            Generate description
          </DropdownMenuItem>
          <DropdownMenuItem disabled={Boolean(disabled)} onSelect={runChecklist}>
            Generate checklist
          </DropdownMenuItem>
          <DropdownMenuItem disabled={Boolean(disabled)} onSelect={runEstimate}>
            Estimate + suggest
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {openPanel === 'description' ? (
        <PendingPanel
          title="Generated description"
          status={description.status}
          error={description.error}
          onAccept={
            description.status === 'done'
              ? () => {
                  onAcceptDescription(description.text);
                  setOpenPanel(null);
                }
              : undefined
          }
          onDiscard={() => setOpenPanel(null)}
        >
          <SafeMarkdown source={description.text || '_(streaming…)_'} />
        </PendingPanel>
      ) : null}

      {openPanel === 'checklist' ? (
        <PendingPanel
          title="Generated checklist"
          status={checklist.status}
          error={checklist.error}
          onAccept={
            checklist.status === 'done' && Array.isArray(checklistResult?.items)
              ? () => {
                  onAcceptChecklist(checklistResult!.items!);
                  setOpenPanel(null);
                }
              : undefined
          }
          onDiscard={() => setOpenPanel(null)}
        >
          {Array.isArray(checklistResult?.items) ? (
            <ul className="list-disc pl-6 text-sm">
              {checklistResult!.items!.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-muted-foreground">Working…</p>
          )}
          {checklistResult?.invocationId ? (
            <AiFeedbackWidget
              workspaceSlug={workspaceSlug}
              invocationId={checklistResult.invocationId}
              className="mt-3"
            />
          ) : null}
        </PendingPanel>
      ) : null}

      {openPanel === 'estimate' ? (
        <PendingPanel
          title="Suggestions"
          status={estimate.isPending ? 'streaming' : estimate.isError ? 'error' : 'done'}
          error={estimate.error instanceof HttpError ? estimate.error : null}
          onDiscard={() => setOpenPanel(null)}
        >
          {estimate.data ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">Estimate:</span> {estimate.data.result.estimate.low}–
                {estimate.data.result.estimate.high} hours (
                {estimate.data.result.estimate.confidence} confidence)
              </p>
              <p>
                <span className="font-medium">Priority:</span> {estimate.data.result.priority}
              </p>
              {estimate.data.result.assignees.length > 0 ? (
                <div>
                  <p className="font-medium">Assignee suggestions:</p>
                  <ul className="mt-1 list-disc pl-6">
                    {estimate.data.result.assignees.map((a) => (
                      <li key={a.userId}>
                        {a.userId} — <span className="italic">{a.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <AiFeedbackWidget
                workspaceSlug={workspaceSlug}
                invocationId={estimate.data.invocationId}
                className="mt-3"
              />
            </div>
          ) : null}
        </PendingPanel>
      ) : null}
    </div>
  );
}

interface PendingPanelProps {
  title: string;
  status: 'idle' | 'streaming' | 'done' | 'error' | 'aborted';
  error: HttpError | null;
  onAccept?: () => void;
  onDiscard: () => void;
  children: React.ReactNode;
}

function PendingPanel({ title, status, error, onAccept, onDiscard, children }: PendingPanelProps) {
  return (
    <section
      className="rounded-md border bg-muted/30 p-3"
      role="region"
      aria-labelledby={`${slugify(title)}-heading`}
      aria-busy={status === 'streaming'}
    >
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 id={`${slugify(title)}-heading`} className="text-sm font-medium">
            {title}
          </h3>
          <AiOutputBadge />
        </div>
        <div className="flex items-center gap-1">
          {onAccept ? (
            <Button size="sm" onClick={onAccept}>
              Use
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </header>
      <div aria-live="polite" aria-atomic="false">
        {status === 'error' && error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {friendlyErrorMessage(error)}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function disabledReason(usage: AiUsageSnapshot | undefined): string | null {
  if (!usage) return 'Loading budget…';
  if (!usage.consent.accepted) return 'Admin must enable AI';
  if (usage.tokensBudget > 0 && usage.tokensConsumed >= usage.tokensBudget) {
    return 'Monthly limit reached';
  }
  return null;
}

function friendlyErrorMessage(err: HttpError): string {
  switch (err.type) {
    case 'about:blank#ai-consent-required':
      return 'This workspace has not enabled AI actions yet.';
    case 'about:blank#ai-budget-exhausted':
      return 'This workspace has reached its monthly AI budget.';
    case 'about:blank#ai-rate-limited':
      return 'Too many AI requests in a short window. Please wait a moment.';
    case 'about:blank#ai-provider-unavailable':
      return 'The AI provider is temporarily unavailable. Please try again in a moment.';
    case 'about:blank#ai-invalid-response':
      return 'The AI returned an unexpected response. Try again — the model can be inconsistent on free tiers.';
    case 'about:blank#ai-aborted':
      return 'The AI action was cancelled.';
    case 'about:blank#ai-insufficient-context':
      return err.detail ?? 'There is not enough context to run this AI action.';
    default:
      return err.title;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
