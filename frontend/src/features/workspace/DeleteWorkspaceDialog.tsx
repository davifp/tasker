'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DeleteWorkspaceDialogProps {
  slug: string;
  name: string;
}

export function DeleteWorkspaceDialog({ slug, name }: DeleteWorkspaceDialogProps) {
  const t = useTranslations('workspace.delete');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();

  function performDelete() {
    startTransition(async () => {
      try {
        await browserHttp.delete(`/workspaces/${encodeURIComponent(slug)}`);
        toast.success(t('success'));
        router.replace('/workspaces/new');
        router.refresh();
      } catch {
        toast.error(t('failed'));
      } finally {
        setOpen(false);
        setConfirmation('');
      }
    });
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmation('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('body', { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-confirmation">{t('typeToConfirm', { name })}</Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmation !== name || isPending}
              onClick={(event) => {
                event.preventDefault();
                performDelete();
              }}
            >
              {isPending ? t('deleting') : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
