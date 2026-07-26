'use client';

import { useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette, useCommandPalette } from '@/features/command-palette/CommandPalette';
import type { WorkspaceOption } from '@/features/workspace/WorkspaceSwitcher';
import { MAIN_CONTENT_ID } from '@/components/shell/SkipToContent';
import { VerificationBanner } from '@/features/verification/VerificationBanner';
import { bff } from '@/lib/http/bff';

interface AppShellProps {
  workspaceSlug: string;
  workspaces: WorkspaceOption[];
  user: { name: string; email: string; emailVerified?: boolean };
  children: React.ReactNode;
}

export function AppShell({ workspaceSlug, workspaces, user, children }: AppShellProps) {
  const { open, setOpen } = useCommandPalette();
  const syncedSlug = useRef<string | null>(null);

  // Keep the tsk_workspace cookie aligned with the URL slug so /api/session and
  // analytics events report the currently-visited workspace. Fire-and-forget —
  // the URL slug is authoritative for backend authorization, so a lagging cookie
  // never causes tenant leakage.
  useEffect(() => {
    if (syncedSlug.current === workspaceSlug) return;
    syncedSlug.current = workspaceSlug;
    bff.post('/workspaces/select', { slug: workspaceSlug }).catch(() => undefined);
  }, [workspaceSlug]);

  return (
    <div className="flex min-h-dvh w-full bg-background text-foreground">
      <Sidebar workspaceSlug={workspaceSlug} />
      <div className="flex min-w-0 flex-1 flex-col">
        {user.emailVerified === false ? <VerificationBanner email={user.email} /> : null}
        <Topbar
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
          user={user}
          onOpenPalette={() => setOpen(true)}
        />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-6 py-8"
        >
          {children}
        </main>
      </div>
      <CommandPalette open={open} onOpenChange={setOpen} workspaceSlug={workspaceSlug} />
    </div>
  );
}
