'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TaskStatus } from '@/lib/http/types';

interface TaskQuickAddProps {
  status: TaskStatus;
  disabled?: boolean;
  onSubmit(title: string, status: TaskStatus): Promise<void> | void;
}

const MAX_TITLE_LEN = 140;

export function TaskQuickAdd({ status, disabled = false, onSubmit }: TaskQuickAddProps) {
  const t = useTranslations('board.quickAdd');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function commit() {
    const title = value.trim();
    if (!title) {
      setOpen(false);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(title, status);
      setValue('');
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
        {t('trigger')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX_TITLE_LEN))}
        placeholder={t('placeholder')}
        aria-label={t('titleLabel')}
        maxLength={MAX_TITLE_LEN}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setValue('');
            setOpen(false);
          }
        }}
        disabled={submitting}
      />
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue('');
            setOpen(false);
          }}
          disabled={submitting}
        >
          {t('cancel')}
        </Button>
        <Button type="button" size="sm" onClick={() => void commit()} disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
