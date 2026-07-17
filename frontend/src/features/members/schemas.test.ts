import { describe, it, expect } from 'vitest';
import { InviteBatchSchema, canManageMember, canManageMembers } from './schemas';

describe('InviteBatchSchema', () => {
  it('accepts 1-10 well-formed rows', () => {
    const parsed = InviteBatchSchema.safeParse({
      invites: [
        { email: 'a@b.co', role: 'MEMBER' },
        { email: 'c@b.co', role: 'ADMIN' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when the batch is empty', () => {
    expect(InviteBatchSchema.safeParse({ invites: [] }).success).toBe(false);
  });

  it('rejects when a row has an invalid email', () => {
    const parsed = InviteBatchSchema.safeParse({
      invites: [{ email: 'not-email', role: 'MEMBER' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects when more than 10 rows', () => {
    const invites = Array.from({ length: 11 }, (_, i) => ({
      email: `u${i}@example.com`,
      role: 'MEMBER' as const,
    }));
    expect(InviteBatchSchema.safeParse({ invites }).success).toBe(false);
  });
});

describe('role gating', () => {
  it('OWNER can manage anyone except other OWNERS', () => {
    expect(canManageMember('OWNER', 'MEMBER')).toBe(true);
    expect(canManageMember('OWNER', 'ADMIN')).toBe(true);
    expect(canManageMember('OWNER', 'OWNER')).toBe(false);
  });

  it('ADMIN can manage MEMBER/GUEST but not other ADMINs or the OWNER', () => {
    expect(canManageMember('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageMember('ADMIN', 'GUEST')).toBe(true);
    expect(canManageMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
  });

  it('MEMBER and GUEST cannot manage members', () => {
    expect(canManageMembers('MEMBER')).toBe(false);
    expect(canManageMembers('GUEST')).toBe(false);
  });
});
