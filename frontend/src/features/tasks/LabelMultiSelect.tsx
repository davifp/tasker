'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Tag } from 'lucide-react';
import { useLabels } from '@/features/labels/hooks/useLabels';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Label } from '@/lib/http/types';

interface LabelMultiSelectProps {
  workspaceSlug: string;
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
}

export function LabelMultiSelect({
  workspaceSlug,
  selectedIds,
  onChange,
}: LabelMultiSelectProps) {
  const t = useTranslations('board.labels');
  const [open, setOpen] = useState(false);
  const { data } = useLabels(workspaceSlug);
  const labels: Label[] = data?.items ?? [];

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((existing) => existing !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const selectedLabels = labels.filter((label) => selectedIds.includes(label.id));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')}
      </span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start"
            aria-label={t('trigger')}
          >
            <Tag className="h-3 w-3" aria-hidden="true" />
            {selectedLabels.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t('empty')}</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {selectedLabels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${label.color}22`, color: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-auto">
          {labels.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t('none')}</div>
          ) : (
            labels.map((label) => {
              const active = selectedIds.includes(label.id);
              return (
                <DropdownMenuItem
                  key={label.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggle(label.id);
                  }}
                  className="flex items-center gap-2"
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: label.color }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-sm">{label.name}</span>
                  <Check
                    className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
