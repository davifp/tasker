'use client';

import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChangeRoleMenu } from './ChangeRoleMenu';
import { RemoveMemberDialog } from './RemoveMemberDialog';
import { canManageMember, type MemberRoleValue } from './schemas';

export interface WorkspaceMember {
  id: string;
  role: MemberRoleValue;
  joinedAt?: string;
  lastActiveAt?: string;
  user: { id: string; name: string; email: string };
}

interface MembersTableProps {
  slug: string;
  members: WorkspaceMember[];
  actorRole: MemberRoleValue | undefined;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function MembersTable({ slug, members, actorRole }: MembersTableProps) {
  const t = useTranslations('members.table');

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 text-left">
              {t('columns.name')}
            </th>
            <th scope="col" className="px-4 py-2 text-left">
              {t('columns.role')}
            </th>
            <th scope="col" className="px-4 py-2 text-left">
              {t('columns.lastActive')}
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              <span className="sr-only">{t('columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const editable = canManageMember(actorRole, member.role);
            return (
              <tr key={member.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs font-semibold">
                        {initials(member.user.name) || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">{member.user.name}</p>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ChangeRoleMenu
                    slug={slug}
                    userId={member.user.id}
                    currentRole={member.role}
                    editable={editable}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {member.lastActiveAt ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <RemoveMemberDialog
                    slug={slug}
                    userId={member.user.id}
                    memberName={member.user.name}
                    editable={editable}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
