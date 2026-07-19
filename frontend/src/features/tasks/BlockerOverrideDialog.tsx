'use client';

import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BlockerOverrideState {
  taskNumber: number;
  taskTitle: string;
  blockers: string[];
}

interface BlockerOverrideDialogProps {
  state: BlockerOverrideState | null;
  onCancel: () => void;
  onConfirm: () => void;
}

// Fires when the board attempts to drop a task with open blockers into
// the `Done` column. Confirms `overrideBlockers=true` re-send; cancel
// rolls the optimistic move back through the useMoveTask invalidation.
export function BlockerOverrideDialog({ state, onCancel, onConfirm }: BlockerOverrideDialogProps) {
  const t = useTranslations('board.blockerDialog');
  const open = state !== null;
  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {state ? t('title', { title: state.taskTitle }) : t('title', { title: '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-sm">
          {state?.blockers.map((label) => (
            <li key={label} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
              <span className="font-mono text-xs text-foreground">{label}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(buttonVariants({ variant: 'destructive' }))}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
