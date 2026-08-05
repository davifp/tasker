import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { ClsService } from 'nestjs-cls';
import { METRICS_REFRESH_CRON_DEFAULT } from '@tasker/config';
import { PrismaService } from '../prisma/prisma.service';
import { runInJobContext, withJobTelemetry } from '../observability/bullmq-tracing';
import {
  METRICS_QUEUE,
  METRICS_REFRESH_JOB_GLOBAL,
  METRICS_REFRESH_JOB_WORKSPACE,
} from '../queues/constants';

const MATVIEWS = ['mv_sprint_daily_burndown', 'mv_workspace_cycle_lead_time'] as const;

interface WorkspaceRefreshData {
  workspaceId: string;
}

@Injectable()
@Processor(METRICS_QUEUE)
export class MetricsRefreshProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MetricsRefreshProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: Redis,
    @InjectQueue(METRICS_QUEUE) private readonly queue: Queue,
    private readonly cls: ClsService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Register the repeatable global refresh at boot; guarded by a short
    // timeout so Redis outages do not block app.listen.
    const cron = this.config.get<string>('METRICS_REFRESH_CRON', METRICS_REFRESH_CRON_DEFAULT);
    const timeoutMs = this.config.get<number>('METRICS_REFRESH_REGISTER_TIMEOUT_MS', 2000);
    try {
      await Promise.race([
        this.queue.add(METRICS_REFRESH_JOB_GLOBAL, withJobTelemetry({}), {
          repeat: { pattern: cron },
          removeOnComplete: 100,
          removeOnFail: 100,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`register metrics refresh job timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);
      this.logger.log(`metrics.refresh repeatable job registered (cron=${cron})`);
    } catch (err) {
      this.logger.warn(
        { err },
        'Failed to register metrics.refresh at boot — will retry next boot',
      );
    }
  }

  async process(job: Job): Promise<{ refreshed: string[] } | { skipped: true }> {
    return runInJobContext(job, this.cls, `process.${METRICS_QUEUE}.${job.name}`, () =>
      this.doProcess(job),
    );
  }

  private async doProcess(job: Job): Promise<{ refreshed: string[] } | { skipped: true }> {
    const workspaceId =
      job.name === METRICS_REFRESH_JOB_WORKSPACE
        ? (job.data as WorkspaceRefreshData).workspaceId
        : null;

    const refreshed: string[] = [];
    const lockTtl = this.config.get<number>('METRICS_REFRESH_LOCK_TTL_SEC', 900);

    for (const matview of MATVIEWS) {
      const lockKey = `metrics:refresh:${matview}`;
      const acquired = await this.redis.set(lockKey, '1', 'EX', lockTtl, 'NX');
      if (!acquired) {
        this.logger.log(`Skipping ${matview} — another worker holds the refresh lock.`);
        continue;
      }

      const started = Date.now();
      const jobLog = await this.prisma.forSystem().metricJobLog.create({
        data: { workspaceId, matview, status: 'RUNNING' },
      });
      try {
        // REFRESH CONCURRENTLY needs a UNIQUE index on the matview — both
        // views ship one from the Task 2.0 migration.
        await this.prisma
          .forSystem()
          .$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${matview}"`);
        await this.prisma.forSystem().metricJobLog.update({
          where: { id: jobLog.id },
          data: {
            status: 'OK',
            finishedAt: new Date(),
            refreshMs: Date.now() - started,
          },
        });
        refreshed.push(matview);
      } catch (err) {
        await this.prisma.forSystem().metricJobLog.update({
          where: { id: jobLog.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            refreshMs: Date.now() - started,
            error: String(err instanceof Error ? err.message : err),
          },
        });
        this.logger.error({ err, matview }, 'metrics.refresh failed');
      } finally {
        await this.redis.del(lockKey);
      }
    }

    if (refreshed.length === 0) return { skipped: true };
    return { refreshed };
  }
}
