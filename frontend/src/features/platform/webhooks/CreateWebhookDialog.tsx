'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@tasker/config';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateWebhook } from './hooks/useWebhooks';
import type { CreateWebhookResponse } from './http';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  onCreated: (result: CreateWebhookResponse) => void;
}

export function CreateWebhookDialog({ open, onOpenChange, workspaceSlug, onCreated }: Props) {
  const t = useTranslations('platform.webhooks');
  const create = useCreateWebhook(workspaceSlug);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<WebhookEventType[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  function resetForm() {
    setUrl('');
    setSelected([]);
    setUrlError(null);
    setEventsError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let hasError = false;
    if (!/^https?:\/\//i.test(url.trim())) {
      setUrlError(t('create.urlLabel'));
      hasError = true;
    }
    if (selected.length === 0) {
      setEventsError(t('create.eventsLabel'));
      hasError = true;
    }
    if (hasError) return;
    try {
      const result = await create.mutateAsync({
        url: url.trim(),
        eventTypes: selected,
      });
      resetForm();
      onCreated(result);
    } catch {
      toast.error(t('toast.createFailed'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="webhook-url">{t('create.urlLabel')}</Label>
            <Input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="https://example.com/webhooks/tasker"
              aria-invalid={urlError !== null}
              aria-describedby={urlError ? 'webhook-url-error' : undefined}
            />
            {urlError ? (
              <p id="webhook-url-error" className="text-xs text-destructive" role="alert">
                {urlError}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">{t('create.eventsLabel')}</legend>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-3">
              {WEBHOOK_EVENT_TYPES.map((event) => {
                const inputId = `webhook-event-${event}`;
                const checked = selected.includes(event);
                return (
                  <label
                    key={event}
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-sm font-mono"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={(e) => {
                        setSelected((prev) =>
                          e.target.checked ? [...prev, event] : prev.filter((s) => s !== event),
                        );
                        if (eventsError) setEventsError(null);
                      }}
                    />
                    <span>{event}</span>
                  </label>
                );
              })}
            </div>
            {eventsError ? (
              <p className="text-xs text-destructive" role="alert">
                {eventsError}
              </p>
            ) : null}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('create.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
