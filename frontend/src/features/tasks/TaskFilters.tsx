'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Tag, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useLabels } from '@/features/labels/hooks/useLabels';
import { useWorkspaceMembers } from '@/features/members/hooks/useWorkspaceMembers';
import type { Label as LabelType } from '@/lib/http/types';
import {
  useBoardFilters,
  type AssigneeFilter,
  type UseBoardFiltersResult,
} from './useBoardFilters';

interface TaskFiltersProps {
  workspaceSlug: string;
  currentUserId: string;
  // Escape hatch so tests can inject a pre-computed hook result without
  // needing to mount the Next.js router context; production callers pass
  // nothing and the hook is read from the URL.
  hookOverride?: UseBoardFiltersResult;
}

function assigneesEqual(a: AssigneeFilter, b: AssigneeFilter): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === 'me' || b === 'me') return a === b;
  return a.userId === b.userId;
}

export function TaskFilters({ workspaceSlug, currentUserId, hookOverride }: TaskFiltersProps) {
  const t = useTranslations('board.filters');
  const boardFilters = useBoardFilters();
  const state = hookOverride ?? boardFilters;
  const { filters, setAssignee, toggleLabel, clear, isEmpty } = state;

  const { data: labelsPage } = useLabels(workspaceSlug);
  const labels: LabelType[] = useMemo(() => labelsPage?.items ?? [], [labelsPage?.items]);
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );

  const { data: members } = useWorkspaceMembers(workspaceSlug);
  const memberList = useMemo(() => members ?? [], [members]);
  const membersByUserId = useMemo(
    () => new Map(memberList.map((member) => [member.userId, member])),
    [memberList],
  );

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const assigneeLabel = getAssigneeLabel({
    filter: filters.assignee,
    currentUserId,
    membersByUserId,
    t,
  });

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-2"
      role="group"
      aria-label={t('groupLabel')}
    >
      <DropdownMenu open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            aria-label={t('assignee.trigger')}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs">{assigneeLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-auto">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setAssignee(null);
              setAssigneeOpen(false);
            }}
            className="flex items-center gap-2"
          >
            <span className="flex-1 text-sm">{t('assignee.any')}</span>
            <Check
              className={cn('h-3 w-3', filters.assignee === null ? 'opacity-100' : 'opacity-0')}
              aria-hidden="true"
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setAssignee('me');
              setAssigneeOpen(false);
            }}
            className="flex items-center gap-2"
          >
            <span className="flex-1 text-sm">{t('assignee.me')}</span>
            <Check
              className={cn('h-3 w-3', filters.assignee === 'me' ? 'opacity-100' : 'opacity-0')}
              aria-hidden="true"
            />
          </DropdownMenuItem>
          {memberList.length > 0 ? <DropdownMenuSeparator /> : null}
          {memberList
            .filter((member) => member.userId !== currentUserId)
            .map((member) => {
              const isActive = assigneesEqual(filters.assignee, { userId: member.userId });
              return (
                <DropdownMenuItem
                  key={member.userId}
                  onSelect={(event) => {
                    event.preventDefault();
                    setAssignee({ userId: member.userId });
                    setAssigneeOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 text-sm">{member.displayName}</span>
                  <Check
                    className={cn('h-3 w-3', isActive ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                </DropdownMenuItem>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu open={labelsOpen} onOpenChange={setLabelsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            aria-label={t('labels.trigger')}
          >
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs">
              {filters.labels.length === 0
                ? t('labels.any')
                : t('labels.count', { count: filters.labels.length })}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-auto">
          {labels.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t('labels.empty')}</div>
          ) : (
            labels.map((label) => {
              const active = filters.labels.includes(label.id);
              return (
                <DropdownMenuItem
                  key={label.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggleLabel(label.id);
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

      <ActiveChips
        filters={filters}
        currentUserId={currentUserId}
        membersByUserId={membersByUserId}
        labelsById={labelsById}
        onClearAssignee={() => setAssignee(null)}
        onRemoveLabel={(id) => toggleLabel(id)}
        t={t}
      />

      {!isEmpty ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-xs"
          onClick={clear}
        >
          {t('clearAll')}
        </Button>
      ) : null}
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<'board.filters'>>;

interface AssigneeLabelInput {
  filter: AssigneeFilter;
  currentUserId: string;
  membersByUserId: Map<string, { displayName: string }>;
  t: Translator;
}

function getAssigneeLabel({ filter, currentUserId, membersByUserId, t }: AssigneeLabelInput): string {
  if (filter === null) return t('assignee.any');
  if (filter === 'me') return t('assignee.me');
  if (filter.userId === currentUserId) return t('assignee.me');
  const member = membersByUserId.get(filter.userId);
  return member?.displayName ?? t('assignee.someone');
}

interface ActiveChipsProps {
  filters: { assignee: AssigneeFilter; labels: string[] };
  currentUserId: string;
  membersByUserId: Map<string, { displayName: string }>;
  labelsById: Map<string, LabelType>;
  onClearAssignee(): void;
  onRemoveLabel(id: string): void;
  t: Translator;
}

function ActiveChips({
  filters,
  currentUserId,
  membersByUserId,
  labelsById,
  onClearAssignee,
  onRemoveLabel,
  t,
}: ActiveChipsProps) {
  const hasAssignee = filters.assignee !== null;
  const hasLabels = filters.labels.length > 0;
  if (!hasAssignee && !hasLabels) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasAssignee ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {getAssigneeLabel({ filter: filters.assignee, currentUserId, membersByUserId, t })}
          <button
            type="button"
            aria-label={t('chips.removeAssignee')}
            onClick={onClearAssignee}
            className="rounded-full p-0.5 hover:bg-primary/20"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {filters.labels.map((id) => {
        const label = labelsById.get(id);
        const displayName = label?.name ?? id;
        const color = label?.color ?? '#64748b';
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {displayName}
            <button
              type="button"
              aria-label={t('chips.removeLabel', { name: displayName })}
              onClick={() => onRemoveLabel(id)}
              className="rounded-full p-0.5 hover:bg-black/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
