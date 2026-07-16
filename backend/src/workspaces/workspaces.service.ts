import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Workspace, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { isReservedSlug } from '@tasker/config';
import { PrismaService } from '../prisma/prisma.service';

const SLUG_RETRY_LIMIT = 3;
const SOFT_DELETE_WINDOW_DAYS = 30;

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  // Creates a workspace, retrying with a numeric suffix on slug collision up to
  // SLUG_RETRY_LIMIT times. Owner membership is created inside the same
  // transaction so we never end up with an ownerless workspace.
  async createWorkspace(params: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<Workspace> {
    if (isReservedSlug(params.slug)) {
      throw new BadRequestException(`Slug '${params.slug}' is reserved`);
    }

    for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
      const candidate = attempt === 0 ? params.slug : `${params.slug}-${attempt + 1}`;
      try {
        return await this.prisma.forSystem().$transaction(async (tx) => {
          const workspace = await tx.workspace.create({
            data: {
              name: params.name,
              slug: candidate,
              ownerUserId: params.ownerUserId,
            },
          });
          await tx.workspaceMember.create({
            data: {
              workspaceId: workspace.id,
              userId: params.ownerUserId,
              role: 'OWNER',
            },
          });
          return workspace;
        });
      } catch (err) {
        if (isUniqueSlugViolation(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException(
      `Slug '${params.slug}' is already in use and no suffix variant is available`,
    );
  }

  async findBySlug(slug: string, includeDeleted = false): Promise<Workspace | null> {
    const workspace = await this.prisma.forSystem().workspace.findUnique({ where: { slug } });
    if (!workspace) return null;
    if (workspace.deletedAt && !includeDeleted) return null;
    return workspace;
  }

  async updateWorkspace(id: string, data: { name?: string }): Promise<Workspace> {
    return this.prisma.forSystem().workspace.update({ where: { id }, data });
  }

  // Soft delete: sets deletedAt + purgeAt = now + 30 days.
  async softDelete(id: string): Promise<Workspace> {
    const now = new Date();
    const purgeAt = new Date(now.getTime() + SOFT_DELETE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.forSystem().workspace.update({
      where: { id },
      data: { deletedAt: now, purgeAt },
    });
  }

  async restore(id: string): Promise<Workspace> {
    const workspace = await this.prisma.forSystem().workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!workspace.deletedAt) throw new BadRequestException('Workspace is not deleted');
    if (workspace.purgeAt && workspace.purgeAt < new Date()) {
      throw new BadRequestException('Workspace has already been purged');
    }
    return this.prisma.forSystem().workspace.update({
      where: { id },
      data: { deletedAt: null, purgeAt: null },
    });
  }

  // Atomically promote the target Admin to Owner and demote the previous Owner
  // to Admin. Refuses if the target isn't an Admin of this workspace.
  async transferOwnership(params: {
    workspaceId: string;
    currentOwnerUserId: string;
    newOwnerUserId: string;
  }): Promise<Workspace> {
    if (params.currentOwnerUserId === params.newOwnerUserId) {
      throw new BadRequestException('Cannot transfer ownership to the current owner');
    }

    return this.prisma.forSystem().$transaction(async (tx) => {
      const target = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: params.workspaceId,
            userId: params.newOwnerUserId,
          },
        },
      });
      if (!target) {
        throw new NotFoundException('Target user is not a member of this workspace');
      }
      if (target.role !== 'ADMIN') {
        throw new BadRequestException('Ownership can only be transferred to an existing Admin');
      }

      await tx.workspaceMember.update({
        where: { id: target.id },
        data: { role: 'OWNER' },
      });
      await tx.workspaceMember.updateMany({
        where: { workspaceId: params.workspaceId, userId: params.currentOwnerUserId },
        data: { role: 'ADMIN' },
      });
      return tx.workspace.update({
        where: { id: params.workspaceId },
        data: { ownerUserId: params.newOwnerUserId },
      });
    });
  }

  // Cursor pagination over members. Cursor is the member's id.
  async listMembers(
    workspaceId: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: WorkspaceMember[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const items = await this.prisma.forSystem().workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { joinedAt: 'asc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async updateMemberRole(params: {
    workspaceId: string;
    targetUserId: string;
    newRole: 'ADMIN' | 'MEMBER' | 'GUEST';
    actorRole: WorkspaceRole;
  }): Promise<WorkspaceMember> {
    return this.prisma.forSystem().$transaction(async (tx) => {
      const target = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: params.workspaceId,
            userId: params.targetUserId,
          },
        },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.role === 'OWNER') {
        throw new ConflictException({
          type: 'https://tasker.dev/problems/sole-owner-demotion',
          title: 'Cannot demote the Owner',
          detail: 'Transfer ownership to another Admin first.',
          status: 409,
        });
      }
      // PRD FR-8: Admin cannot demote/promote another Admin — only the Owner can.
      if (target.role === 'ADMIN' && params.actorRole !== 'OWNER') {
        throw new ForbiddenException({
          type: 'https://tasker.dev/problems/admin-cannot-touch-admin',
          title: 'Admins cannot change another Admin',
          detail: 'Only the Owner can change the role of another Admin.',
          status: 403,
        });
      }
      return tx.workspaceMember.update({
        where: { id: target.id },
        data: { role: params.newRole as WorkspaceRole },
      });
    });
  }

  // Removes a member. Self-leave is allowed for Members and Guests; Admins can
  // remove any non-Owner; the sole Owner cannot be removed.
  async removeMember(params: {
    workspaceId: string;
    targetUserId: string;
    actorUserId: string;
    actorRole: WorkspaceRole;
  }): Promise<void> {
    await this.prisma.forSystem().$transaction(async (tx) => {
      const target = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: params.workspaceId,
            userId: params.targetUserId,
          },
        },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.role === 'OWNER') {
        throw new ConflictException({
          type: 'https://tasker.dev/problems/sole-owner-removal',
          title: 'Cannot remove the Owner',
          detail: 'Transfer ownership to another Admin first.',
          status: 409,
        });
      }
      // PRD FR-8: only the Owner can remove another Admin (Admins cannot remove each other).
      // Self-remove ('leave workspace') bypasses this — the caller is leaving voluntarily.
      const isSelfRemove = params.targetUserId === params.actorUserId;
      if (!isSelfRemove && target.role === 'ADMIN' && params.actorRole !== 'OWNER') {
        throw new ForbiddenException({
          type: 'https://tasker.dev/problems/admin-cannot-touch-admin',
          title: 'Admins cannot remove another Admin',
          detail: 'Only the Owner can remove another Admin.',
          status: 403,
        });
      }
      await tx.workspaceMember.delete({ where: { id: target.id } });
    });
  }

  async findMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.forSystem().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }
}

function isUniqueSlugViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
    (err.meta as { target: string[] }).target.includes('slug')
  );
}
