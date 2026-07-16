import { SetMetadata } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';

export const ROLES_KEY = 'roles' as const;

// Marks a handler as requiring at least the given role. Combined with the
// hierarchy in roles.ts: `@Roles('ADMIN')` also permits OWNER.
export const Roles = (...roles: WorkspaceRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
