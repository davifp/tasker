'use client';

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, Rows2, Rows3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Task, TaskLabel, WorkspaceRole } from '@/lib/http/types';
import type { TaskSortField } from '@/features/queryKeys';
import { cn } from '@/lib/utils';
import { useProjectTasks } from '../hooks/useProjectTasks';
import { useProjectFilters, toTaskFilters } from '../useProjectFilters';
import { PriorityChip } from '../PriorityChip';
import { DueDatePill } from '../DueDatePill';
import { AssigneeBubble } from '../AssigneeBubble';
import { TaskDrawer } from '../TaskDrawer';
import { ColumnPicker, type ColumnPickerItem } from './ColumnPicker';

interface ListViewProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  initialTaskNumber?: number;
}

type Density = 'compact' | 'comfortable';

// Column ids double as `@tanstack/react-table` `accessorKey` / `id` and as
// the URL-persisted sort field name (for the four sortable columns).
const COLUMN_IDS = [
  'title',
  'status',
  'assignee',
  'priority',
  'dueDate',
  'labels',
  'updated',
] as const;

type ColumnId = (typeof COLUMN_IDS)[number];

// Only these columns feed back into `useProjectFilters.setSort()` — the
// server sorts by the same set. `assignee` and `labels` are multi-value
// and have no meaningful cross-row ordering, so they render as
// non-sortable headers even though the DOM cells still highlight.
const SORTABLE_FIELDS: Record<ColumnId, TaskSortField | null> = {
  title: 'title',
  status: null,
  assignee: null,
  priority: 'priority',
  dueDate: 'dueDate',
  labels: null,
  updated: 'updatedAt',
};

function labelChipStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}22`, color };
}

function LabelChips({ labels }: { labels: TaskLabel[] | undefined }) {
  const t = useTranslations('list.labels');
  if (!labels || labels.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('empty')}</span>;
  }
  const shown = labels.slice(0, 2);
  const overflow = labels.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
          style={labelChipStyle(label.color)}
          title={label.name}
        >
          {label.name}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t('overflow', { count: overflow })}
        </span>
      ) : null}
    </span>
  );
}

function formatRelative(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

interface HeaderCellProps {
  columnId: ColumnId;
  label: string;
  sortField: TaskSortField | null;
  activeField: TaskSortField | null;
  activeDir: 'asc' | 'desc' | null;
  onSort: (field: TaskSortField) => void;
}

function HeaderSortCell({
  columnId,
  label,
  sortField,
  activeField,
  activeDir,
  onSort,
}: HeaderCellProps) {
  const t = useTranslations('list.sort');
  const canSort = sortField !== null;
  const isActive = canSort && sortField === activeField;
  const currentDir = isActive ? activeDir : null;

  if (!canSort) {
    return <span className="inline-flex items-center gap-1">{label}</span>;
  }

  const description = isActive
    ? currentDir === 'asc'
      ? t('ariaCurrentAsc')
      : t('ariaCurrentDesc')
    : t('ariaNone');

  function handleClick() {
    onSort(sortField as TaskSortField);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSort(sortField as TaskSortField);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKey}
      className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-left uppercase tracking-wide text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={description}
      data-column-id={columnId}
      data-sort-active={isActive || undefined}
      data-sort-dir={isActive ? currentDir : undefined}
    >
      <span>{label}</span>
      {isActive ? (
        currentDir === 'asc' ? (
          <ArrowUp aria-hidden="true" className="h-3 w-3" />
        ) : (
          <ArrowDown aria-hidden="true" className="h-3 w-3" />
        )
      ) : (
        <ChevronsUpDown aria-hidden="true" className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

/**
 * Density toggle button — flips `compact <-> comfortable` on each click.
 * Persists only in component state for now (Task 8.0 wires this into
 * durable per-user prefs). Keeps the surface tiny so it fits inline with
 * the column picker + filter chips row.
 */
function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange(next: Density): void;
}) {
  const t = useTranslations('list.density');
  const next: Density = value === 'compact' ? 'comfortable' : 'compact';
  const Icon = value === 'compact' ? Rows3 : Rows2;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={t('trigger')}
      aria-pressed={value === 'compact'}
      onClick={() => onChange(next)}
      data-testid="list-density-toggle"
      data-density={value}
    >
      <Icon aria-hidden="true" />
      <span>{value === 'compact' ? t('compact') : t('comfortable')}</span>
    </Button>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  const t = useTranslations('list.empty');
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center"
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{t('title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClear}
        data-testid="list-empty-clear"
      >
        {t('clear')}
      </Button>
    </div>
  );
}

function ListSkeleton() {
  const t = useTranslations('list');
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

// Advance the (field, dir) sort tuple through the required cycle. First
// click on a fresh column sets `asc`; a repeat click on the same column
// flips to `desc`; a third click clears the sort entirely.
function nextSortState(
  clicked: TaskSortField,
  currentField: TaskSortField | null,
  currentDir: 'asc' | 'desc' | null,
): { field: TaskSortField | null; dir: 'asc' | 'desc' | null } {
  if (currentField !== clicked) return { field: clicked, dir: 'asc' };
  if (currentDir === 'asc') return { field: clicked, dir: 'desc' };
  return { field: null, dir: null };
}

const DEFAULT_VISIBILITY: VisibilityState = COLUMN_IDS.reduce<VisibilityState>(
  (acc, id) => {
    acc[id] = true;
    return acc;
  },
  {},
);

const DEFAULT_ORDER: ColumnOrderState = [...COLUMN_IDS];

/**
 * List view for a project — dense, sortable, configurable-columns table
 * built on shadcn `Table` primitives + `@tanstack/react-table` headless.
 * Data flows through `useProjectTasks` so switching to/from any of the
 * Phase-4 views shares a single TanStack Query cache entry (see
 * `taskKeys.list` canonicalization).
 */
export function ListView({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  currentUserId,
  currentUserRole,
  initialTaskNumber,
}: ListViewProps) {
  const t = useTranslations('list');
  const columnLabels = useTranslations('list.columns');
  const statusLabels = useTranslations('board.columns');
  const assigneeLabels = useTranslations('list.assignee');
  const locale = useLocale();
  const projectFilters = useProjectFilters();
  const { filters, setSort, clear } = projectFilters;
  const taskFilters = useMemo(
    () => toTaskFilters(filters, currentUserId),
    [filters, currentUserId],
  );
  const { data, isLoading, isError } = useProjectTasks(
    workspaceSlug,
    projectSlug,
    taskFilters,
    { limit: 100 },
  );

  // Persisted only in component state — Task 8.0 will migrate to useViewPreferences.
  const [density, setDensity] = useState<Density>('compact');
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(DEFAULT_ORDER);
  const [openTaskNumber, setOpenTaskNumber] = useState<number | null>(
    initialTaskNumber ?? null,
  );

  // If the deep-link prop changes (client navigation to another task URL
  // without a full remount), reflect the new target so the drawer follows.
  useEffect(() => {
    if (initialTaskNumber !== undefined) setOpenTaskNumber(initialTaskNumber);
  }, [initialTaskNumber]);

  const rows: Task[] = useMemo(() => data?.items ?? [], [data?.items]);

  const sortingState: SortingState = useMemo(() => {
    if (!filters.sort) return [];
    const inverse: Partial<Record<TaskSortField, ColumnId>> = {
      title: 'title',
      priority: 'priority',
      dueDate: 'dueDate',
      updatedAt: 'updated',
    };
    const columnId = inverse[filters.sort];
    if (!columnId) return [];
    return [{ id: columnId, desc: filters.sortDir === 'desc' }];
  }, [filters.sort, filters.sortDir]);

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: () => columnLabels('title'),
        cell: ({ row }) => (
          <span className="line-clamp-2 font-medium text-foreground">
            {row.original.title}
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: () => columnLabels('status'),
        cell: ({ row }) => (
          <span className="text-xs font-medium text-muted-foreground">
            {statusLabels(row.original.status)}
          </span>
        ),
      },
      {
        id: 'assignee',
        accessorKey: 'assigneeUserId',
        header: () => columnLabels('assignee'),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <AssigneeBubble userId={row.original.assigneeUserId} />
            {row.original.assigneeUserId ? null : (
              <span className="text-xs text-muted-foreground">
                {assigneeLabels('unassigned')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: () => columnLabels('priority'),
        cell: ({ row }) => <PriorityChip priority={row.original.priority} />,
      },
      {
        id: 'dueDate',
        accessorKey: 'dueDate',
        header: () => columnLabels('dueDate'),
        cell: ({ row }) =>
          row.original.dueDate ? (
            <DueDatePill dueDate={row.original.dueDate} />
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('dueDate.empty')}
            </span>
          ),
      },
      {
        id: 'labels',
        accessorKey: 'labels',
        header: () => columnLabels('labels'),
        cell: ({ row }) => <LabelChips labels={row.original.labels} />,
      },
      {
        id: 'updated',
        accessorKey: 'updatedAt',
        header: () => columnLabels('updated'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatRelative(row.original.updatedAt, locale)}
          </span>
        ),
      },
    ],
    [assigneeLabels, columnLabels, locale, statusLabels, t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting: sortingState, columnVisibility, columnOrder },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    // Sorting is server-driven via `useProjectFilters.setSort()`; the
    // table stays "manual" so `@tanstack/react-table` does not re-sort
    // rows on top of the already-sorted server payload.
    manualSorting: true,
    enableSortingRemoval: true,
    getRowId: (task) => task.id,
  });

  const activeSortField = filters.sort;
  const activeSortDir = filters.sortDir;

  const handleSort = useCallback(
    (clicked: TaskSortField) => {
      const next = nextSortState(clicked, activeSortField, activeSortDir);
      setSort(next.field, next.dir);
    },
    [activeSortField, activeSortDir, setSort],
  );

  const pickerItems: ColumnPickerItem[] = useMemo(
    () => COLUMN_IDS.map((id) => ({ id, label: columnLabels(id) })),
    [columnLabels],
  );

  function handleOpenRow(taskNumber: number) {
    setOpenTaskNumber(taskNumber);
  }

  function handleRowKey(event: KeyboardEvent<HTMLTableRowElement>, taskNumber: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleOpenRow(taskNumber);
    }
  }

  const rowSpacing = density === 'compact' ? 'py-1.5' : 'py-3';
  const cellSpacing = density === 'compact' ? 'py-1.5 px-2' : 'py-3 px-3';

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <ToolbarShell>
          <DensityToggle value={density} onChange={setDensity} />
          <ColumnPicker
            columns={pickerItems}
            order={columnOrder}
            visibility={columnVisibility as Record<string, boolean>}
            onOrderChange={setColumnOrder}
            onVisibilityChange={setColumnVisibility}
          />
        </ToolbarShell>
        <ListSkeleton />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {t('errorLoad')}
      </div>
    );
  }

  const isEmpty = rows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <ToolbarShell>
        <DensityToggle value={density} onChange={setDensity} />
        <ColumnPicker
          columns={pickerItems}
          order={columnOrder}
          visibility={columnVisibility as Record<string, boolean>}
          onOrderChange={setColumnOrder}
          onVisibilityChange={setColumnVisibility}
        />
      </ToolbarShell>
      {isEmpty ? (
        <EmptyState onClear={clear} />
      ) : (
        <Table data-testid="list-table" data-density={density}>
          <caption className="sr-only">{t('caption')}</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const columnId = header.column.id as ColumnId;
                  const sortField = SORTABLE_FIELDS[columnId] ?? null;
                  const isActive =
                    sortField !== null && sortField === activeSortField;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        isActive
                          ? activeSortDir === 'desc'
                            ? 'descending'
                            : 'ascending'
                          : sortField
                            ? 'none'
                            : undefined
                      }
                      scope="col"
                    >
                      {header.isPlaceholder ? null : sortField ? (
                        <HeaderSortCell
                          columnId={columnId}
                          label={columnLabels(columnId)}
                          sortField={sortField}
                          activeField={activeSortField}
                          activeDir={activeSortDir}
                          onSort={handleSort}
                        />
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={0}
                role="row"
                aria-label={t('openRow', {
                  number: row.original.number,
                  title: row.original.title,
                })}
                className={cn(
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  rowSpacing,
                )}
                data-task-id={row.original.id}
                data-task-number={row.original.number}
                onClick={() => handleOpenRow(row.original.number)}
                onKeyDown={(event) => handleRowKey(event, row.original.number)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cellSpacing}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <TaskDrawer
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        projectSlug={projectSlug}
        projectId={projectId}
        taskNumber={openTaskNumber}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        focusTitleOnMount={initialTaskNumber !== undefined}
        onClose={() => setOpenTaskNumber(null)}
        onDelete={() => setOpenTaskNumber(null)}
      />
    </div>
  );
}

function ToolbarShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
  );
}

// Re-exported for test fixtures / storybook seeds that need the initial
// column layout without importing the whole ListView module.
export { COLUMN_IDS as LIST_COLUMN_IDS, DEFAULT_VISIBILITY, DEFAULT_ORDER };
