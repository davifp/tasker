'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MarkdownPreview } from './MarkdownPreview';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  minHeightClass?: string;
}

// Simple editor: textarea (Write) + rendered preview toggle. No fancy
// toolbar — the surface is small and keyboard-first. `Cmd+Enter` saves;
// `Escape` cancels. Preview uses the same MarkdownPreview component
// mounted by the drawer so what-you-see is what-gets-committed.
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving = false,
  minHeightClass = 'min-h-[120px]',
}: MarkdownEditorProps) {
  const t = useTranslations('board.description');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1" role="tablist" aria-label={t('modeSwitcherLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'write'}
          onClick={() => setMode('write')}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium',
            mode === 'write' ? 'bg-muted text-foreground' : 'text-muted-foreground',
          )}
        >
          {t('write')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          onClick={() => setMode('preview')}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium',
            mode === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground',
          )}
        >
          {t('preview')}
        </button>
      </div>
      {mode === 'write' ? (
        <textarea
          className={cn(
            'w-full rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-ring',
            minHeightClass,
          )}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={t('placeholder')}
          aria-label={t('label')}
        />
      ) : (
        <div className={cn('rounded-md border border-border bg-background p-3', minHeightClass)}>
          {value.trim() ? (
            <MarkdownPreview markdown={value} />
          ) : (
            <p className="text-xs text-muted-foreground">{t('nothingToPreview')}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
