'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface PendingInvitation {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'GUEST';
  invitedAt: string;
}

interface PendingInvitationsListProps {
  slug: string;
  invitations: PendingInvitation[];
  canManage: boolean;
}

export function PendingInvitationsList({
  slug,
  invitations,
  canManage,
}: PendingInvitationsListProps) {
  const t = useTranslations('members.pending');
  const tRoles = useTranslations('members.invite.roles');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resend(id: string) {
    startTransition(async () => {
      try {
        await browserHttp.post(`/workspaces/${encodeURIComponent(slug)}/invitations/${id}/resend`);
        toast.success(t('resendSuccess'));
      } catch {
        toast.error(t('resendFailed'));
      }
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      try {
        await browserHttp.delete(`/workspaces/${encodeURIComponent(slug)}/invitations/${id}`);
        toast.success(t('revokeSuccess'));
        router.refresh();
      } catch {
        toast.error(t('revokeFailed'));
      }
    });
  }

  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {invitations.map((invitation) => (
        <li
          key={invitation.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
            <p className="text-xs text-muted-foreground">
              {t('invitedAt', { date: invitation.invitedAt })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{tRoles(invitation.role)}</Badge>
            {canManage ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => resend(invitation.id)}
                  aria-label={t('resend')}
                >
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t('resend')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => revoke(invitation.id)}
                  aria-label={t('revoke')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t('revoke')}</span>
                </Button>
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
