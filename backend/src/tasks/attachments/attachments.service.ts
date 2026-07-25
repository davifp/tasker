import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Attachment, AttachmentStatus, WorkspaceRole } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

export interface SignUploadInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

export interface SignedUploadView {
  attachmentId: string;
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface AttachmentView {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: AttachmentStatus;
  uploaderUserId: string;
  createdAt: Date;
}

export interface AttachmentPage {
  items: AttachmentView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  async signUpload(input: SignUploadInput): Promise<SignedUploadView> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: input.taskId },
      select: { workspaceId: true, projectId: true, deletedAt: true },
    });
    if (!task || task.workspaceId !== input.workspaceId || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    const storageKey = buildStorageKey(input.workspaceId);
    const attachment = await client.attachment.create({
      data: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        uploaderUserId: input.actorUserId,
        storageKey,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        status: AttachmentStatus.PENDING,
      },
    });

    const signed = await this.storage.signPutUrl({
      key: storageKey,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
    });

    return {
      attachmentId: attachment.id,
      uploadUrl: signed.url,
      storageKey,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async confirm(
    workspaceId: string,
    attachmentId: string,
    actor: { userId: string; displayName?: string },
  ): Promise<AttachmentView> {
    const client = this.prisma.forSystem();
    const row = await this.findOwn(client, workspaceId, attachmentId);
    if (row.status === AttachmentStatus.READY) return toView(row);
    if (row.status !== AttachmentStatus.PENDING) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/attachment-not-confirmable',
        title: 'Attachment is in a terminal state',
        status: 400,
      });
    }
    if (row.uploaderUserId !== actor.userId) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/attachment-not-confirmable',
        title: 'Only the uploader can confirm an attachment',
        status: 403,
      });
    }

    const updated = await client.$transaction(async tx => {
      const upd = await tx.attachment.update({
        where: { id: attachmentId },
        data: { status: AttachmentStatus.READY },
      });
      await this.activity.record(tx, {
        workspaceId,
        projectId: (
          await tx.task.findUniqueOrThrow({
            where: { id: row.taskId },
            select: { projectId: true },
          })
        ).projectId,
        taskId: row.taskId,
        actorUserId: actor.userId,
        verb: 'attachment.uploaded',
        payload: {
          actorDisplayName: actor.displayName,
          attachmentId,
          attachmentFilename: row.filename,
        },
      });
      return upd;
    });
    return toView(updated);
  }

  async list(
    workspaceId: string,
    taskId: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<AttachmentPage> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException('Task not found');
    }

    const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const rows = await client.attachment.findMany({
      where: { workspaceId, taskId, status: AttachmentStatus.READY, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(toView);
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  async remove(
    workspaceId: string,
    attachmentId: string,
    actor: { userId: string; role: WorkspaceRole; displayName?: string },
  ): Promise<void> {
    const client = this.prisma.forSystem();
    const row = await this.findOwn(client, workspaceId, attachmentId);
    if (row.status === AttachmentStatus.DELETING || row.deletedAt !== null) return;
    if (!canDelete(row.uploaderUserId, actor)) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/attachment-not-deletable',
        title: 'Only the uploader or an Admin can remove this attachment',
        status: 403,
      });
    }

    await client.$transaction(async tx => {
      await tx.attachment.update({
        where: { id: attachmentId },
        data: { status: AttachmentStatus.DELETING, deletedAt: new Date() },
      });
      await this.activity.record(tx, {
        workspaceId,
        projectId: (
          await tx.task.findUniqueOrThrow({
            where: { id: row.taskId },
            select: { projectId: true },
          })
        ).projectId,
        taskId: row.taskId,
        actorUserId: actor.userId,
        verb: 'attachment.removed',
        payload: {
          actorDisplayName: actor.displayName,
          attachmentId,
          attachmentFilename: row.filename,
        },
      });
    });

    // Storage delete fires after commit — a rollback must not orphan the
    // storage object.
    await this.storage.scheduleDelete(row.storageKey);
  }

  async signDownload(workspaceId: string, attachmentId: string): Promise<{ url: string }> {
    const client = this.prisma.forSystem();
    const row = await this.findOwn(client, workspaceId, attachmentId);
    if (row.status !== AttachmentStatus.READY || row.deletedAt !== null) {
      throw new NotFoundException('Attachment not found');
    }
    return { url: await this.storage.signGetUrl(row.storageKey) };
  }

  /**
   * Janitor sweep: drops PENDING rows older than the threshold and asks
   * storage to remove any residue. Returns the number of rows swept.
   * Idempotent — the storage delete swallows errors so a re-run cannot
   * fail on a missing object.
   */
  async sweepOrphanPending(olderThan: Date): Promise<{ swept: number }> {
    const client = this.prisma.forSystem();
    const rows = await client.attachment.findMany({
      where: {
        status: AttachmentStatus.PENDING,
        createdAt: { lt: olderThan },
      },
      select: { id: true, storageKey: true },
      take: 200,
    });
    if (rows.length === 0) return { swept: 0 };
    for (const r of rows) {
      await this.storage.scheduleDelete(r.storageKey);
    }
    await client.attachment.deleteMany({
      where: { id: { in: rows.map(r => r.id) } },
    });
    return { swept: rows.length };
  }

  private async findOwn(
    client: ReturnType<PrismaService['forSystem']>,
    workspaceId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const row = await client.attachment.findUnique({ where: { id: attachmentId } });
    if (!row || row.workspaceId !== workspaceId) {
      throw new NotFoundException('Attachment not found');
    }
    return row;
  }
}

function toView(row: Attachment): AttachmentView {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    status: row.status,
    uploaderUserId: row.uploaderUserId,
    createdAt: row.createdAt,
  };
}

function canDelete(
  uploaderUserId: string,
  actor: { userId: string; role: WorkspaceRole },
): boolean {
  if (actor.role === 'OWNER' || actor.role === 'ADMIN') return true;
  return uploaderUserId === actor.userId;
}

function buildStorageKey(workspaceId: string): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `attachments/${workspaceId}/${y}/${m}/${randomUUID()}`;
}
