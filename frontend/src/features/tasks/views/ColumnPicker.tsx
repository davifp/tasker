'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Descriptor consumed by {@link ColumnPicker}. `id` mirrors the
 * `@tanstack/react-table` column id so caller sites can feed the picker
 * output straight into `state.columnOrder` / `state.columnVisibility`.
 */
export interface ColumnPickerItem {
  id: string;
  label: string;
}

interface ColumnPickerProps {
  columns: ColumnPickerItem[];
  order: string[];
  visibility: Record<string, boolean>;
  onOrderChange(next: string[]): void;
  onVisibilityChange(next: Record<string, boolean>): void;
}

// Reorders `order` by moving the item at `index` by `direction` (-1 up,
// +1 down). Returns a new array; no-op if the move would fall off the ends.
function moveWithin(order: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(index, 1);
  if (item === undefined) return order;
  next.splice(target, 0, item);
  return next;
}

/**
 * Column visibility + order picker for the List view. Uses buttons for
 * reorder rather than drag to stay keyboard-native (Space toggles the
 * checkbox, Arrow keys navigate menu items, Enter fires the move
 * buttons). Persistence lives in the caller — this component is pure UI.
 */
export function ColumnPicker({
  columns,
  order,
  visibility,
  onOrderChange,
  onVisibilityChange,
}: ColumnPickerProps) {
  const t = useTranslations('list.columnPicker');

  // Preserve caller-provided order; any columns missing from `order`
  // (defensive — should not happen once initial state is settled) are
  // appended in their original position for stable rendering.
  const orderedItems = (() => {
    const byId = new Map(columns.map((c) => [c.id, c] as const));
    const seen = new Set<string>();
    const result: ColumnPickerItem[] = [];
    for (const id of order) {
      const item = byId.get(id);
      if (item) {
        result.push(item);
        seen.add(id);
      }
    }
    for (const item of columns) {
      if (!seen.has(item.id)) result.push(item);
    }
    return result;
  })();

  function toggle(id: string) {
    onVisibilityChange({ ...visibility, [id]: !(visibility[id] ?? true) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('trigger')}
          data-testid="list-column-picker-trigger"
        >
          <Columns3 aria-hidden="true" />
          <span>{t('trigger')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>{t('heading')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ul role="none" className="flex flex-col">
          {orderedItems.map((item, index) => {
            const checked = visibility[item.id] ?? true;
            const isFirst = index === 0;
            const isLast = index === orderedItems.length - 1;
            return (
              <li key={item.id} className="flex items-center gap-1 px-1 py-0.5">
                <label
                  className={cn(
                    'flex flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted focus-within:bg-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={checked}
                    aria-label={t('toggle', { name: item.label })}
                    onChange={() => toggle(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t('moveUp', { name: item.label })}
                  disabled={isFirst}
                  onClick={() => onOrderChange(moveWithin(order, index, -1))}
                >
                  <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t('moveDown', { name: item.label })}
                  disabled={isLast}
                  onClick={() => onOrderChange(moveWithin(order, index, 1))}
                >
                  <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
