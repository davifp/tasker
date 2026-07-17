'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useTranslations('shell.commandPalette');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t('placeholder')} aria-label={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('empty')}</CommandEmpty>
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
