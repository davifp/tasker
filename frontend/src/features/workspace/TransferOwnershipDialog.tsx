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
import { Label } from '@/components/ui/label';

export interface AdminCandidate {
  id: string;
  name: string;
  email: string;
}

interface TransferOwnershipDialogProps {
  slug: string;
  admins: AdminCandidate[];
}

type Step = 'closed' | 'select' | 'confirm';

export function TransferOwnershipDialog({ slug, admins }: TransferOwnershipDialogProps) {
  const t = useTranslations('workspace.transfer');
  const router = useRouter();
  const [step, setStep] = useState<Step>('closed');
  const [selected, setSelected] = useState<AdminCandidate | null>(null);
  const [isPending, startTransition] = useTransition();

  function performTransfer() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await browserHttp.post(`/workspaces/${encodeURIComponent(slug)}/transfer-ownership`, {
          userId: selected.id,
        });
        toast.success(t('success'));
        router.refresh();
      } catch {
        toast.error(t('failed'));
      } finally {
        setStep('closed');
        setSelected(null);
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setStep('select')} disabled={admins.length === 0}>
        {t('trigger')}
      </Button>

      <AlertDialog
        open={step === 'select'}
        onOpenChange={(open) => setStep(open ? 'select' : 'closed')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('selectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('selectBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            {admins.map((admin) => (
              <label
                key={admin.id}
                className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="transfer-admin"
                  className="mr-3"
                  checked={selected?.id === admin.id}
                  onChange={() => setSelected(admin)}
                />
                <span className="flex-1">
                  <span className="font-medium text-foreground">{admin.name}</span>{' '}
                  <span className="text-muted-foreground">{admin.email}</span>
                </span>
              </label>
            ))}
            {admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noAdmins')}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!selected}
              onClick={(event) => {
                event.preventDefault();
                setStep('confirm');
              }}
            >
              {t('continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={step === 'confirm'}
        onOpenChange={(open) => setStep(open ? 'confirm' : 'closed')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmBody', { name: selected?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label className="text-sm font-medium">
            {t('summary', { name: selected?.name ?? '' })}
          </Label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                performTransfer();
              }}
            >
              {isPending ? t('transferring') : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
