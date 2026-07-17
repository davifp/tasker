'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { bff } from '@/lib/http/bff';

interface UserMenuProps {
  name: string;
  email: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ name, email }: UserMenuProps) {
  const t = useTranslations('shell.userMenu');
  const router = useRouter();
  const [, startTransition] = useTransition();

  function logout() {
    startTransition(async () => {
      await bff.post('/auth/logout').catch(() => undefined);
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('label', { name })}>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-semibold">
              {initials(name) || '?'}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>
          <p className="text-sm font-medium leading-none">{name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            logout();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
