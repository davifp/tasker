import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_PROVIDER, MailProvider } from '../common/mail/mail.provider';
import { CLEANUP_JOB, CLEANUP_QUEUE, PURGE_WARNING_JOB } from './constants';

type CleanupJobData = Record<string, never>;

interface PurgeWarningJobData {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  purgeAt: string; // ISO — used as part of the idempotency key
}

interface CleanupResult {
  expiredTokens: { verification: number; passwordReset: number };
  expiredSessions: number;
  purgedWorkspaces: number;
  scheduledWarnings: number;
  purgedNotifications: number;
  reapedPushSubscriptions: number;
  purgedWebhookDeliveries: number;
  purgedWebhookDlq: number;
}

@Injectable()
@Processor(CLEANUP_QUEUE)
export class CleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @InjectQueue(CLEANUP_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  // Schedules the repeatable cleanup job at boot. BullMQ dedups repeatable
  // definitions by (name + cron), so multiple API instances calling this are
  // safe — only one repeatable is registered.
  //
  // The registration is bounded by a short timeout so a Redis outage does not
  // block application boot. If it fails, the next successful boot re-registers.
  async onModuleInit(): Promise<void> {
    const cron = this.config.get<string>('CLEANUP_CRON', '0 3 * * *');
    const bootTimeoutMs = this.config.get<number>('CLEANUP_REGISTER_TIMEOUT_MS', 2000);
    try {
      await Promise.race([
        this.queue.add(
          CLEANUP_JOB,
          {},
          {
            repeat: { pattern: cron },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`register cleanup job timed out after ${bootTimeoutMs}ms`)),
            bootTimeoutMs,
          ),
        ),
      ]);
      this.logger.log({ cron }, 'Cleanup repeatable job registered');
    } catch (err) {
      this.logger.warn(
        { err },
        'Failed to register cleanup repeatable job at boot — will retry on next boot',
      );
    }
  }

  async process(job: Job): Promise<CleanupResult | { skipped: true }> {
    if (job.name === PURGE_WARNING_JOB) {
      await this.sendPurgeWarning(job as Job<PurgeWarningJobData>);
      return { skipped: false } as unknown as CleanupResult;
    }

    return this.runCleanup(job as Job<CleanupJobData>);
  }

  // Public for direct invocation from tests — the processor entry point above
  // does the same, but tests want to bypass BullMQ wiring.
  async runCleanup(job: Job<CleanupJobData>): Promise<CleanupResult> {
    const now = new Date();
    const retentionDays = this.config.get<number>('SESSION_RETENTION_DAYS', 7);
    const sessionCutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const warningLeadDays = this.config.get<number>('PURGE_WARNING_LEAD_DAYS', 3);
    const warningWindow = new Date(now.getTime() + warningLeadDays * 24 * 60 * 60 * 1000);
    const notificationRetentionDays = this.config.get<number>('NOTIFICATION_RETENTION_DAYS', 90);
    const notificationCutoff = new Date(
      now.getTime() - notificationRetentionDays * 24 * 60 * 60 * 1000,
    );
    const pushDormantDays = this.config.get<number>('PUSH_DORMANT_DAYS', 60);
    const pushDormantCutoff = new Date(now.getTime() - pushDormantDays * 24 * 60 * 60 * 1000);
    const webhookRetentionDays = this.config.get<number>('WEBHOOK_DELIVERY_RETENTION_DAYS', 30);
    const webhookCutoff = new Date(now.getTime() - webhookRetentionDays * 24 * 60 * 60 * 1000);

    const result: CleanupResult = {
      expiredTokens: { verification: 0, passwordReset: 0 },
      expiredSessions: 0,
      purgedWorkspaces: 0,
      scheduledWarnings: 0,
      purgedNotifications: 0,
      reapedPushSubscriptions: 0,
      purgedWebhookDeliveries: 0,
      purgedWebhookDlq: 0,
    };

    try {
      const verification = await this.prisma
        .forSystem()
        .emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } });
      result.expiredTokens.verification = verification.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge expired verification tokens');
    }

    try {
      const passwordReset = await this.prisma
        .forSystem()
        .passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } });
      result.expiredTokens.passwordReset = passwordReset.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge expired password reset tokens');
    }

    try {
      const sessions = await this.prisma
        .forSystem()
        .session.deleteMany({ where: { expiresAt: { lt: sessionCutoff } } });
      result.expiredSessions = sessions.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge expired sessions');
    }

    try {
      // Hard-delete workspaces past purgeAt. Cascades: WorkspaceMember,
      // Invitation, and AuditLog(workspaceId) rows (schema onDelete: Cascade
      // for members + invitations; AuditLog.workspaceId is nullable so its
      // FK falls back to SET NULL, keeping the security trail intact).
      const purged = await this.prisma
        .forSystem()
        .workspace.deleteMany({ where: { purgeAt: { lt: now } } });
      result.purgedWorkspaces = purged.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge workspaces past their purge date');
    }

    try {
      result.scheduledWarnings = await this.scheduleWarnings(now, warningWindow);
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to schedule purge warnings');
    }

    try {
      // Notification retention: bell rows older than the retention window are
      // no longer surfaced in the UI (bell dropdown truncates to the last 90
      // days by design), so purging them keeps the table lean without user
      // impact. Read-state is preserved implicitly — the row is gone.
      const notifications = await this.prisma
        .forSystem()
        .notification.deleteMany({ where: { createdAt: { lt: notificationCutoff } } });
      result.purgedNotifications = notifications.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge stale notifications');
    }

    try {
      const deliveries = await this.prisma
        .forSystem()
        .webhookDelivery.deleteMany({ where: { enqueuedAt: { lt: webhookCutoff } } });
      result.purgedWebhookDeliveries = deliveries.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge old webhook deliveries');
    }

    try {
      // DLQ rows use the `expiresAt` column set at insert time (30 days out),
      // so we sweep by that column rather than createdAt.
      const dlq = await this.prisma
        .forSystem()
        .webhookDeliveryDLQ.deleteMany({ where: { expiresAt: { lt: now } } });
      result.purgedWebhookDlq = dlq.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to purge expired webhook DLQ rows');
    }

    try {
      // Dormant push subscription sweep. `lastSeenAt` is bumped every time
      // `PushChannel.send` successfully delivers to an endpoint, so a stale
      // `lastSeenAt` is a strong signal that the browser abandoned the
      // registration (uninstall / cleared storage). 60 days is aligned with
      // the FCM/Windows push endpoint TTL guidance.
      const dormant = await this.prisma
        .forSystem()
        .pushSubscription.deleteMany({ where: { lastSeenAt: { lt: pushDormantCutoff } } });
      result.reapedPushSubscriptions = dormant.count;
    } catch (err) {
      this.logger.warn({ err, jobId: job.id }, 'Failed to reap dormant push subscriptions');
    }

    this.logger.log({ jobId: job.id, ...result }, 'Cleanup pass complete');
    return result;
  }

  // Fans out purge-warning jobs for workspaces whose purgeAt falls inside the
  // configured lead window. Idempotency is achieved through the BullMQ jobId
  // — the same (workspaceId, purgeAt) pair always produces the same key, so a
  // job that already ran (in-flight or completed and still cached) is skipped.
  private async scheduleWarnings(now: Date, warningWindow: Date): Promise<number> {
    const candidates = await this.prisma.forSystem().workspace.findMany({
      where: {
        deletedAt: { not: null },
        purgeAt: { gte: now, lt: warningWindow },
      },
      select: {
        id: true,
        name: true,
        purgeAt: true,
        owner: { select: { email: true } },
      },
    });

    let scheduled = 0;
    for (const workspace of candidates) {
      if (!workspace.purgeAt || !workspace.owner?.email) continue;
      const purgeIso = workspace.purgeAt.toISOString();
      const jobId = `purge-warning:${workspace.id}:${purgeIso}`;
      try {
        await this.queue.add(
          PURGE_WARNING_JOB,
          {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            ownerEmail: workspace.owner.email,
            purgeAt: purgeIso,
          } satisfies PurgeWarningJobData,
          {
            jobId,
            removeOnComplete: false,
            removeOnFail: 100,
          },
        );
        scheduled++;
      } catch (err) {
        // BullMQ throws on jobId collision only inside the same queue.add call
        // if the id already exists in the queue; a completed job with the same
        // id may or may not be rejected depending on the version. Either way,
        // duplicate scheduling is exactly what we want to skip silently.
        this.logger.debug(
          { err, workspaceId: workspace.id },
          'Purge warning already scheduled or in-flight — skipping',
        );
      }
    }

    return scheduled;
  }

  private async sendPurgeWarning(job: Job<PurgeWarningJobData>): Promise<void> {
    const { workspaceId, workspaceName, ownerEmail, purgeAt } = job.data;

    // Belt-and-suspenders: if the workspace was restored (or purged early)
    // between scheduling and now, skip. This avoids sending stale warnings
    // even if the queue lags.
    const current = await this.prisma
      .forSystem()
      .workspace.findUnique({ where: { id: workspaceId }, select: { purgeAt: true } });
    if (!current || !current.purgeAt || current.purgeAt.toISOString() !== purgeAt) {
      this.logger.log({ jobId: job.id, workspaceId }, 'Skipping stale purge warning');
      return;
    }

    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const restoreUrl = `${baseUrl}/workspaces/${workspaceId}/restore`;

    await this.mail.send({
      template: 'workspace-purge-warning',
      to: ownerEmail,
      variables: {
        workspaceName,
        purgeDate: new Date(purgeAt).toISOString().slice(0, 10),
        restoreUrl,
      },
      idempotencyKey: `purge-warning-${workspaceId}-${purgeAt}`,
    });
  }
}
