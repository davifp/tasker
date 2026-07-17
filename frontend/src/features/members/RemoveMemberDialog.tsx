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

interface RemoveMemberDialogProps {
  slug: string;
  userId: string;
  memberName: string;
  editable: boolean;
}

export function RemoveMemberDialog({
  slug,
  userId,
  memberName,
  editable,
}: RemoveMemberDialogProps) {
  const t = useTranslations('members.remove');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function performRemove() {
    startTransition(async () => {
      try {
        await browserHttp.delete(`/workspaces/${encodeURIComponent(slug)}/members/${userId}`);
        toast.success(t('success'));
        router.refresh();
      } catch {
        toast.error(t('failed'));
      } finally {
        setOpen(false);
      }
    });
  }

  if (!editable) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('body', { name: memberName })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                performRemove();
              }}
            >
              {isPending ? t('removing') : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
