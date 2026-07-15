import { describe, it, expect } from 'vitest';
import { TENANT_MODELS, applyTenantContext } from './tenant.extension';

const WS = 'ws-1';

// ---------------------------------------------------------------------------
// TENANT_MODELS allowlist
// ---------------------------------------------------------------------------

describe('TENANT_MODELS', () => {
  it('includes models that carry a workspaceId field', () => {
    expect(TENANT_MODELS.has('WorkspaceMember')).toBe(true);
    expect(TENANT_MODELS.has('Invitation')).toBe(true);
    expect(TENANT_MODELS.has('AuditLog')).toBe(true);
  });

  it('excludes non-tenant models', () => {
    expect(TENANT_MODELS.has('User')).toBe(false);
    expect(TENANT_MODELS.has('OAuthAccount')).toBe(false);
    expect(TENANT_MODELS.has('Session')).toBe(false);
    expect(TENANT_MODELS.has('EmailVerificationToken')).toBe(false);
    expect(TENANT_MODELS.has('PasswordResetToken')).toBe(false);
    expect(TENANT_MODELS.has('Workspace')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyTenantContext — args mutation
// ---------------------------------------------------------------------------

describe('applyTenantContext()', () => {
  it('is a no-op for non-tenant models', () => {
    const args: Record<string, unknown> = { where: { email: 'a@b.com' } };
    applyTenantContext('User', 'findFirst', args, WS);
    expect(args['where']).toEqual({ email: 'a@b.com' });
  });

  describe('WHERE operations', () => {
    const WHERE_OPS = ['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'];

    for (const op of WHERE_OPS) {
      it(`injects workspaceId into where for ${op}`, () => {
        const args: Record<string, unknown> = { where: { userId: 'u-1' } };
        applyTenantContext('WorkspaceMember', op, args, WS);
        expect((args['where'] as Record<string, unknown>)['workspaceId']).toBe(WS);
        expect((args['where'] as Record<string, unknown>)['userId']).toBe('u-1');
      });

      it(`our workspaceId wins over user-supplied value in ${op}`, () => {
        const args: Record<string, unknown> = { where: { workspaceId: 'evil-ws', userId: 'u-1' } };
        applyTenantContext('WorkspaceMember', op, args, WS);
        expect((args['where'] as Record<string, unknown>)['workspaceId']).toBe(WS);
      });
    }

    it('handles missing where by creating it', () => {
      const args: Record<string, unknown> = {};
      applyTenantContext('WorkspaceMember', 'findMany', args, WS);
      expect((args['where'] as Record<string, unknown>)['workspaceId']).toBe(WS);
    });
  });

  describe('create', () => {
    it('injects workspaceId into data', () => {
      const args: Record<string, unknown> = { data: { email: 'invite@w1.com', role: 'MEMBER' } };
      applyTenantContext('Invitation', 'create', args, WS);
      expect((args['data'] as Record<string, unknown>)['workspaceId']).toBe(WS);
    });

    it('our workspaceId wins over user-supplied value in data', () => {
      const args: Record<string, unknown> = { data: { workspaceId: 'evil-ws', role: 'MEMBER' } };
      applyTenantContext('Invitation', 'create', args, WS);
      expect((args['data'] as Record<string, unknown>)['workspaceId']).toBe(WS);
    });

    it('is a no-op when data is absent', () => {
      const args: Record<string, unknown> = {};
      applyTenantContext('Invitation', 'create', args, WS);
      expect(args['data']).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('injects workspaceId into both where and create sub-object', () => {
      const args: Record<string, unknown> = {
        where: { workspaceId_userId: { workspaceId: 'evil-ws', userId: 'u-1' } },
        create: { workspaceId: 'evil-ws', userId: 'u-1', role: 'MEMBER' },
        update: { role: 'ADMIN' },
      };
      applyTenantContext('WorkspaceMember', 'upsert', args, WS);
      expect((args['where'] as Record<string, unknown>)['workspaceId']).toBe(WS);
      expect((args['create'] as Record<string, unknown>)['workspaceId']).toBe(WS);
    });

    it('does not touch update sub-object', () => {
      const args: Record<string, unknown> = {
        where: {},
        create: { userId: 'u-1', role: 'MEMBER' },
        update: { role: 'ADMIN' },
      };
      applyTenantContext('WorkspaceMember', 'upsert', args, WS);
      expect((args['update'] as Record<string, unknown>)['workspaceId']).toBeUndefined();
    });
  });

  describe('createMany', () => {
    it('injects workspaceId into every item in the data array', () => {
      const args: Record<string, unknown> = {
        data: [
          { userId: 'u-1', role: 'MEMBER' },
          { userId: 'u-2', role: 'GUEST' },
        ],
      };
      applyTenantContext('WorkspaceMember', 'createMany', args, WS);
      const data = args['data'] as Record<string, unknown>[];
      expect(data[0]['workspaceId']).toBe(WS);
      expect(data[1]['workspaceId']).toBe(WS);
    });

    it('our workspaceId wins over spoofed values in each item', () => {
      const args: Record<string, unknown> = {
        data: [{ userId: 'u-1', role: 'MEMBER', workspaceId: 'evil-ws' }],
      };
      applyTenantContext('WorkspaceMember', 'createMany', args, WS);
      const data = args['data'] as Record<string, unknown>[];
      expect(data[0]['workspaceId']).toBe(WS);
    });

    it('is a no-op when data is not an array', () => {
      const args: Record<string, unknown> = { data: undefined };
      applyTenantContext('WorkspaceMember', 'createMany', args, WS);
      expect(args['data']).toBeUndefined();
    });

    it('is a no-op for non-tenant models', () => {
      const args: Record<string, unknown> = {
        data: [{ email: 'a@b.com', displayName: 'A' }],
      };
      applyTenantContext('User', 'createMany', args, WS);
      const data = args['data'] as Record<string, unknown>[];
      expect(data[0]['workspaceId']).toBeUndefined();
    });
  });
});
