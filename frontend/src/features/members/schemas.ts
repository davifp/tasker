import { z } from 'zod';

export const MemberRole = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']);
export type MemberRoleValue = z.infer<typeof MemberRole>;

export const InviteRole = z.enum(['ADMIN', 'MEMBER', 'GUEST']);
export type InviteRoleValue = z.infer<typeof InviteRole>;

const inviteRow = z.object({
  email: z.string().trim().min(1, 'email.required').email('email.invalid'),
  role: InviteRole,
});

export const InviteBatchSchema = z.object({
  invites: z.array(inviteRow).min(1, 'invites.min').max(10, 'invites.max'),
});
export type InviteBatchInput = z.infer<typeof InviteBatchSchema>;

export const ROLE_ORDER: readonly MemberRoleValue[] = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'];

export function canManageMembers(role: MemberRoleValue | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canManageMember(
  actor: MemberRoleValue | undefined,
  target: MemberRoleValue,
): boolean {
  if (!canManageMembers(actor)) return false;
  if (target === 'OWNER') return false;
  if (actor === 'ADMIN' && target === 'ADMIN') return false;
  return true;
}
