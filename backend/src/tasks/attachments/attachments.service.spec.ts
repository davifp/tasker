import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AttachmentStatus } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { ActivityService } from '../../common/activity/activity.service';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const PROJECT = 'proj-1';
const TASK = 'task-1';
const USER = 'user-1';
const ADMIN = 'user-admin';
const ATTACHMENT = 'att-1';
const STORAGE_KEY = 'attachments/ws-1/2026/07/deadbeef';

interface RowInit {
  id?: string;
  workspaceId?: string;
  taskId?: string;
  uploaderUserId?: string;
  storageKey?: string;
  filename?: string;
  mime?: string;
  sizeBytes?: number;
  status?: AttachmentStatus;
  createdAt?: Date;
  deletedAt?: Date | null;
}

function makeRow(init: RowInit = {}) {
  return {
    id: init.id ?? ATTACHMENT,
    workspaceId: init.workspaceId ?? WS,
    taskId: init.taskId ?? TASK,
    uploaderUserId: init.uploaderUserId ?? USER,
    storageKey: init.storageKey ?? STORAGE_KEY,
    filename: init.filename ?? 'file.png',
    mime: init.mime ?? 'image/png',
    sizeBytes: init.sizeBytes ?? 1024,
    status: init.status ?? AttachmentStatus.PENDING,
    createdAt: init.createdAt ?? new Date('2026-07-25T10:00:00Z'),
    deletedAt: init.deletedAt ?? null,
  };
}

interface SuiteOpts {
  task?: { workspaceId?: string; projectId?: string; deletedAt?: Date | null } | null;
  row?: RowInit | null;
  pendingRows?: Array<{ id: string; storageKey: string }>;
  listRows?: Array<RowInit>;
}

function makeSuite(opts: SuiteOpts = {}) {
  const taskFindUnique = vi.fn().mockResolvedValue(
    opts.task === null
      ? null
      : {
          workspaceId: WS,
          projectId: PROJECT,
          deletedAt: null,
          ...(opts.task ?? {}),
        },
  );
  const taskFindUniqueOrThrow = vi.fn().mockResolvedValue({ projectId: PROJECT });
  const attachmentCreate = vi.fn().mockImplementation(async ({ data }: { data: RowInit }) =>
    makeRow({ ...data, id: ATTACHMENT }),
  );
  const attachmentFindUnique = vi
    .fn()
    .mockResolvedValue(opts.row === null ? null : makeRow(opts.row ?? {}));
  const attachmentUpdate = vi.fn().mockImplementation(async ({ data }: { data: RowInit }) =>
    makeRow({ ...(opts.row ?? {}), ...data }),
  );
  const attachmentFindMany = vi
    .fn()
    .mockResolvedValueOnce((opts.listRows ?? opts.pendingRows ?? []).map(r => makeRow(r as RowInit)));
  const attachmentDeleteMany = vi.fn().mockResolvedValue({ count: opts.pendingRows?.length ?? 0 });

  const txClient = {
    attachment: { update: attachmentUpdate },
    task: { findUniqueOrThrow: taskFindUniqueOrThrow },
  };

  const raw = {
    task: { findUnique: taskFindUnique },
    attachment: {
      create: attachmentCreate,
      findUnique: attachmentFindUnique,
      findMany: attachmentFindMany,
      deleteMany: attachmentDeleteMany,
    },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
  };
  const prisma = { forSystem: () => raw } as unknown as PrismaService;

  const signPutUrl = vi.fn().mockResolvedValue({
    url: 'https://s3/signed/put',
    key: STORAGE_KEY,
    expiresAt: new Date('2026-07-25T10:15:00Z'),
  });
  const signGetUrl = vi.fn().mockResolvedValue('https://s3/signed/get');
  const scheduleDelete = vi.fn().mockResolvedValue(undefined);
  const storage = { signPutUrl, signGetUrl, scheduleDelete } as unknown as StorageService;

  const activityRecord = vi.fn().mockResolvedValue({ id: 'a-1' });
  const activity = { record: activityRecord } as unknown as ActivityService;

  const svc = new AttachmentsService(prisma, storage, activity);

  return {
    svc,
    raw,
    taskFindUnique,
    attachmentCreate,
    attachmentFindUnique,
    attachmentUpdate,
    attachmentFindMany,
    attachmentDeleteMany,
    signPutUrl,
    signGetUrl,
    scheduleDelete,
    activityRecord,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('AttachmentsService.signUpload', () => {
  it('creates a PENDING row and returns a signed PUT url', async () => {
    const s = makeSuite();
    const out = await s.svc.signUpload({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      actorUserId: USER,
      filename: 'a.png',
      mime: 'image/png',
      sizeBytes: 1024,
    });

    expect(s.attachmentCreate).toHaveBeenCalledTimes(1);
    const createArgs = s.attachmentCreate.mock.calls[0]![0] as { data: RowInit };
    expect(createArgs.data.status).toBe(AttachmentStatus.PENDING);
    expect(createArgs.data.workspaceId).toBe(WS);
    expect(createArgs.data.taskId).toBe(TASK);
    expect(createArgs.data.storageKey).toMatch(/^attachments\/ws-1\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/);

    expect(s.signPutUrl).toHaveBeenCalledWith({
      key: createArgs.data.storageKey,
      mime: 'image/png',
      sizeBytes: 1024,
    });
    expect(out.uploadUrl).toBe('https://s3/signed/put');
    expect(out.attachmentId).toBe(ATTACHMENT);
    expect(out.storageKey).toBe(createArgs.data.storageKey);
  });

  it('throws 404 when the task does not exist', async () => {
    const s = makeSuite({ task: null });
    await expect(
      s.svc.signUpload({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        actorUserId: USER,
        filename: 'a.png',
        mime: 'image/png',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(s.attachmentCreate).not.toHaveBeenCalled();
    expect(s.signPutUrl).not.toHaveBeenCalled();
  });

  it('throws 404 when the task belongs to another workspace', async () => {
    const s = makeSuite({ task: { workspaceId: OTHER_WS } });
    await expect(
      s.svc.signUpload({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        actorUserId: USER,
        filename: 'a.png',
        mime: 'image/png',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(s.signPutUrl).not.toHaveBeenCalled();
  });

  it('throws 404 when the task is soft-deleted', async () => {
    const s = makeSuite({ task: { deletedAt: new Date() } });
    await expect(
      s.svc.signUpload({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        actorUserId: USER,
        filename: 'a.png',
        mime: 'image/png',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AttachmentsService.confirm', () => {
  it('transitions PENDING -> READY and emits activity.attachment.uploaded', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.PENDING, uploaderUserId: USER } });
    const view = await s.svc.confirm(WS, ATTACHMENT, { userId: USER, displayName: 'Ana' });
    expect(view.status).toBe(AttachmentStatus.READY);
    expect(s.attachmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AttachmentStatus.READY } }),
    );
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        verb: 'attachment.uploaded',
        payload: expect.objectContaining({
          actorDisplayName: 'Ana',
          attachmentId: ATTACHMENT,
          attachmentFilename: 'file.png',
        }),
      }),
    );
  });

  it('is idempotent when already READY — no update, no activity', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY, uploaderUserId: USER } });
    const view = await s.svc.confirm(WS, ATTACHMENT, { userId: USER });
    expect(view.status).toBe(AttachmentStatus.READY);
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
    expect(s.activityRecord).not.toHaveBeenCalled();
  });

  it('rejects confirm when the row is DELETING (terminal state)', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.DELETING, uploaderUserId: USER } });
    await expect(s.svc.confirm(WS, ATTACHMENT, { userId: USER })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
  });

  it('rejects confirm from a non-uploader with 403', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.PENDING, uploaderUserId: USER } });
    await expect(s.svc.confirm(WS, ATTACHMENT, { userId: 'someone-else' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
  });

  it('throws 404 for cross-workspace access', async () => {
    const s = makeSuite({ row: { workspaceId: OTHER_WS } });
    await expect(s.svc.confirm(WS, ATTACHMENT, { userId: USER })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AttachmentsService.list', () => {
  it('throws 404 when the task does not exist or belongs to another workspace', async () => {
    const s = makeSuite({ task: { workspaceId: OTHER_WS } });
    await expect(s.svc.list(WS, TASK)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns items and null cursor when under the page size', async () => {
    const s = makeSuite({
      listRows: [
        { id: 'a1', status: AttachmentStatus.READY, filename: 'a.png' },
        { id: 'a2', status: AttachmentStatus.READY, filename: 'b.png' },
      ],
    });
    const page = await s.svc.list(WS, TASK, { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    expect(s.attachmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WS, taskId: TASK, status: AttachmentStatus.READY, deletedAt: null },
        take: 11,
      }),
    );
  });

  it('returns nextCursor when there are more rows than the limit', async () => {
    const s = makeSuite({
      listRows: [
        { id: 'a1', status: AttachmentStatus.READY, filename: 'a.png' },
        { id: 'a2', status: AttachmentStatus.READY, filename: 'b.png' },
        { id: 'a3', status: AttachmentStatus.READY, filename: 'c.png' },
      ],
    });
    const page = await s.svc.list(WS, TASK, { limit: 2 });
    expect(page.items.map(i => i.id)).toEqual(['a1', 'a2']);
    expect(page.nextCursor).toBe('a2');
  });
});

describe('AttachmentsService.remove', () => {
  it('lets the uploader remove and emits activity.attachment.removed + schedules storage delete', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY, uploaderUserId: USER } });
    await s.svc.remove(WS, ATTACHMENT, { userId: USER, role: 'MEMBER', displayName: 'Ana' });
    expect(s.attachmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AttachmentStatus.DELETING }),
      }),
    );
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'attachment.removed' }),
    );
    expect(s.scheduleDelete).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('lets an ADMIN remove an attachment uploaded by someone else', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY, uploaderUserId: USER } });
    await s.svc.remove(WS, ATTACHMENT, { userId: ADMIN, role: 'ADMIN' });
    expect(s.attachmentUpdate).toHaveBeenCalled();
    expect(s.scheduleDelete).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('rejects a non-uploader non-admin with 403', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY, uploaderUserId: USER } });
    await expect(
      s.svc.remove(WS, ATTACHMENT, { userId: 'other', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
    expect(s.scheduleDelete).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already DELETING', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.DELETING, uploaderUserId: USER } });
    await s.svc.remove(WS, ATTACHMENT, { userId: USER, role: 'MEMBER' });
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
    expect(s.scheduleDelete).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already soft-deleted', async () => {
    const s = makeSuite({
      row: { status: AttachmentStatus.READY, uploaderUserId: USER, deletedAt: new Date() },
    });
    await s.svc.remove(WS, ATTACHMENT, { userId: USER, role: 'MEMBER' });
    expect(s.attachmentUpdate).not.toHaveBeenCalled();
    expect(s.scheduleDelete).not.toHaveBeenCalled();
  });

  it('throws 404 for a cross-workspace attachment', async () => {
    const s = makeSuite({ row: { workspaceId: OTHER_WS } });
    await expect(
      s.svc.remove(WS, ATTACHMENT, { userId: USER, role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AttachmentsService.signDownload', () => {
  it('returns a signed GET url for a READY attachment', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY } });
    const out = await s.svc.signDownload(WS, ATTACHMENT);
    expect(out.url).toBe('https://s3/signed/get');
    expect(s.signGetUrl).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('throws 404 when the row is PENDING', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.PENDING } });
    await expect(s.svc.signDownload(WS, ATTACHMENT)).rejects.toBeInstanceOf(NotFoundException);
    expect(s.signGetUrl).not.toHaveBeenCalled();
  });

  it('throws 404 when the row is soft-deleted', async () => {
    const s = makeSuite({ row: { status: AttachmentStatus.READY, deletedAt: new Date() } });
    await expect(s.svc.signDownload(WS, ATTACHMENT)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AttachmentsService.sweepOrphanPending', () => {
  it('deletes stale PENDING rows and schedules storage cleanup for each', async () => {
    const s = makeSuite({
      pendingRows: [
        { id: 'p1', storageKey: 'attachments/ws-1/2026/07/aaa' },
        { id: 'p2', storageKey: 'attachments/ws-1/2026/07/bbb' },
      ],
    });
    const out = await s.svc.sweepOrphanPending(new Date('2026-07-25T09:00:00Z'));
    expect(out.swept).toBe(2);
    expect(s.scheduleDelete).toHaveBeenCalledTimes(2);
    expect(s.attachmentDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['p1', 'p2'] } } }),
    );
  });

  it('returns 0 when no stale rows are found (skips storage + delete)', async () => {
    const s = makeSuite({ pendingRows: [] });
    const out = await s.svc.sweepOrphanPending(new Date('2026-07-25T09:00:00Z'));
    expect(out.swept).toBe(0);
    expect(s.scheduleDelete).not.toHaveBeenCalled();
    expect(s.attachmentDeleteMany).not.toHaveBeenCalled();
  });
});
