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
  rawSecret: string;
  url: string;
}

// Reveal panel for the raw webhook secret. Mirrors RevealKeyDialog: shown
// once at create + once after rotate, then never again.
export function RevealSecretDialog({ open, onOpenChange, rawSecret, url }: Props) {
  const t = useTranslations('platform.webhooks.reveal');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rawSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
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
          <p className="text-xs uppercase text-muted-foreground">{url}</p>
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
            <code className="flex-1 truncate font-mono text-xs" aria-label="Webhook secret">
              {rawSecret}
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
