'use client';

import { createContext, useContext, useMemo } from 'react';
import type { WorkspaceRole } from '@/lib/http/types';

export interface WorkspaceRoleCapabilities {
  role: WorkspaceRole;
  isDemo: boolean;
  canWrite: boolean;
  canManageWorkspace: boolean;
  canManageMembers: boolean;
  canManageRoadmap: boolean;
}

const Ctx = createContext<WorkspaceRoleCapabilities | null>(null);

interface ProviderProps {
  role: WorkspaceRole;
  children: React.ReactNode;
}

export function WorkspaceRoleProvider({ role, children }: ProviderProps): React.JSX.Element {
  const value = useMemo<WorkspaceRoleCapabilities>(() => {
    const isDemo = role === 'DEMO_VIEWER';
    const canWrite = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
    const canManageMembers = role === 'OWNER' || role === 'ADMIN';
    const canManageWorkspace = role === 'OWNER';
    const canManageRoadmap = role === 'OWNER' || role === 'ADMIN';
    return {
      role,
      isDemo,
      canWrite,
      canManageMembers,
      canManageWorkspace,
      canManageRoadmap,
    };
  }, [role]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaceRole(): WorkspaceRoleCapabilities {
  const value = useContext(Ctx);
  if (!value) {
    // The workspace layout wraps every route under /(app)/[workspace]/**;
    // this fallback keeps unit tests that render leaf components in
    // isolation from crashing without a provider.
    return {
      role: 'MEMBER',
      isDemo: false,
      canWrite: true,
      canManageMembers: false,
      canManageWorkspace: false,
      canManageRoadmap: false,
    };
  }
  return value;
}
