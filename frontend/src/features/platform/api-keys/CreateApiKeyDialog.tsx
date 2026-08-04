'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { API_KEY_SCOPES, type ApiKeyScope } from '@tasker/config';
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
import { useCreateApiKey } from './hooks/useApiKeys';
import type { CreateApiKeyResponse } from './http';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  onCreated: (result: CreateApiKeyResponse) => void;
}

export function CreateApiKeyDialog({ open, onOpenChange, workspaceSlug, onCreated }: Props) {
  const t = useTranslations('platform.apiKeys');
  const create = useCreateApiKey(workspaceSlug);
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopesError, setScopesError] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setSelectedScopes([]);
    setExpiresAt('');
    setNameError(null);
    setScopesError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let hasError = false;
    if (name.trim().length === 0) {
      setNameError(t('create.nameLabel'));
      hasError = true;
    }
    if (selectedScopes.length === 0) {
      setScopesError(t('create.scopesLabel'));
      hasError = true;
    }
    if (hasError) return;

    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        scopes: selectedScopes,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
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
            <Label htmlFor="api-key-name">{t('create.nameLabel')}</Label>
            <Input
              id="api-key-name"
              type="text"
              maxLength={60}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder={t('create.namePlaceholder')}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? 'api-key-name-error' : undefined}
            />
            {nameError ? (
              <p id="api-key-name-error" className="text-xs text-destructive" role="alert">
                {nameError}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">{t('create.scopesLabel')}</legend>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-3">
              {API_KEY_SCOPES.map((scope) => {
                const inputId = `api-key-scope-${scope.replace(':', '-')}`;
                const checked = selectedScopes.includes(scope);
                return (
                  <label
                    key={scope}
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-sm font-mono"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedScopes((prev) =>
                          e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                        );
                        if (scopesError) setScopesError(null);
                      }}
                    />
                    <span>{scope}</span>
                  </label>
                );
              })}
            </div>
            {scopesError ? (
              <p className="text-xs text-destructive" role="alert">
                {scopesError}
              </p>
            ) : null}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-expires-at">{t('create.expiresAtLabel')}</Label>
            <Input
              id="api-key-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              aria-describedby="api-key-expires-at-help"
            />
            <p id="api-key-expires-at-help" className="text-xs text-muted-foreground">
              {t('create.expiresAtHelp')}
            </p>
          </div>

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
