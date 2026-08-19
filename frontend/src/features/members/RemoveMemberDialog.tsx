'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { membersKeys } from './hooks/useWorkspaceMembers';
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
  workspaceId?: string;
}

export function RemoveMemberDialog({
  slug,
  userId,
  memberName,
  workspaceId,
  editable,
}: RemoveMemberDialogProps) {
  const t = useTranslations('members.remove');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const emit = useAnalytics();

  function performRemove() {
    startTransition(async () => {
      try {
        await browserHttp.delete(`/workspaces/${encodeURIComponent(slug)}/members/${userId}`);
        if (workspaceId) emit({ name: 'member_removed', workspaceId });
        toast.success(t('success'));
        void queryClient.invalidateQueries({ queryKey: membersKeys.all(slug) });
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
