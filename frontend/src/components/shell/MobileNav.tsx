'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { primaryNavLinks, managementNavLinks } from './nav-links';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  workspaceSlug: string;
}

export function MobileNav({ workspaceSlug }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const t = useTranslations('shell.nav');

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('openNav')} className="md:hidden">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-6">
        <SheetHeader className="mb-4">
          <SheetTitle>
            <span className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              Tasker
            </span>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1">
          {primaryNavLinks.map((link) => {
            const Icon = link.icon;
            const active = link.match(pathname, workspaceSlug);
            return (
              <Link
                key={link.key}
                href={link.href(workspaceSlug)}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(link.key)}
              </Link>
            );
          })}
        </nav>
        <Separator className="my-4" />
        <nav className="flex flex-col gap-1">
          {managementNavLinks.map((link) => {
            const Icon = link.icon;
            const active = link.match(pathname, workspaceSlug);
            return (
              <Link
                key={link.key}
                href={link.href(workspaceSlug)}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(link.key)}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
