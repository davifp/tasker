'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawKey: string;
  name: string;
}

/**
 * Reveal panel — the one place in the app that renders the raw API key. Closes
 * only via the explicit "I've saved it" button so a misclick outside the dialog
 * doesn't dismiss the value before it's copied.
 */
export function RevealKeyDialog({ open, onOpenChange, rawKey, name }: Props) {
  const t = useTranslations('platform.apiKeys.reveal');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
    } catch {
      // Clipboard blocked (permissions, insecure origin). Fall back silently —
      // the user can still select-and-copy from the visible <code> block.
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block outside-click dismissal — force the user through the confirm
        // button so the raw value is not lost by accident.
        if (!next && !copied) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (!copied) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase text-muted-foreground">{name}</p>
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
            <code className="flex-1 truncate font-mono text-xs" aria-label="API key value">
              {rawKey}
            </code>
            <Button type="button" size="sm" variant="secondary" onClick={handleCopy}>
              {copied ? t('copied') : t('copyButton')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
