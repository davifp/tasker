'use client';

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { METRIC_DEFINITIONS, type MetricKey } from '@tasker/config';

export interface MetricDefinitionPopoverProps {
  metric: MetricKey;
}

/**
 * Surfaces the locked metric definition inline next to the number
 * (PRD FR-28). Copy comes verbatim from `@tasker/config` so the popover
 * text and the calculator agree — a definition change requires a
 * documented workspace-level migration.
 */
export function MetricDefinitionPopover({
  metric,
}: MetricDefinitionPopoverProps): React.JSX.Element {
  const definition = METRIC_DEFINITIONS[metric];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`Definition: ${definition}`}
          data-testid={`metric-definition-${metric}`}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {definition}
      </TooltipContent>
    </Tooltip>
  );
}
