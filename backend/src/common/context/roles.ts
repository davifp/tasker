import { WorkspaceRole } from '@prisma/client';

// Hierarchy: OWNER > ADMIN > MEMBER > GUEST.
// A role satisfies a requirement if its rank is >= the required rank.
const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  GUEST: 1,
};

export function satisfiesRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
