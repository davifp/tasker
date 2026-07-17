'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { InviteRole, type InviteRoleValue, type MemberRoleValue } from './schemas';

interface ChangeRoleMenuProps {
  slug: string;
  userId: string;
  currentRole: MemberRoleValue;
  editable: boolean;
}

export function ChangeRoleMenu({ slug, userId, currentRole, editable }: ChangeRoleMenuProps) {
  const t = useTranslations('members.role');
  const tRoles = useTranslations('members.invite.roles');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function changeRole(role: InviteRoleValue) {
    if (role === currentRole || !editable) return;
    startTransition(async () => {
      try {
        await browserHttp.patch(`/workspaces/${encodeURIComponent(slug)}/members/${userId}`, {
          role,
        });
        toast.success(t('changed'));
        router.refresh();
      } catch {
        toast.error(t('failed'));
      }
    });
  }

  if (!editable) {
    return <span className="text-sm">{tRoles(currentRole)}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          {tRoles(currentRole)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {InviteRole.options.map((role) => (
          <DropdownMenuItem
            key={role}
            onSelect={(event) => {
              event.preventDefault();
              changeRole(role);
            }}
          >
            {tRoles(role)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
