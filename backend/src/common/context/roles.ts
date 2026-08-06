import { WorkspaceRole } from '@prisma/client';

// Hierarchy: OWNER > ADMIN > MEMBER > GUEST > DEMO_VIEWER.
// A role satisfies a requirement if its rank is >= the required rank.
// DEMO_VIEWER is intentionally below GUEST so any `@RequireRoles('GUEST')`
// endpoint denies the demo account — enforcing read-only at the guard layer.
const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  GUEST: 1,
  DEMO_VIEWER: 0,
};

export function satisfiesRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
