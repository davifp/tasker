import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { AttachmentsService } from '../tasks/attachments/attachments.service';
import { runInJobContext, withJobTelemetry } from '../observability/bullmq-tracing';
import { ATTACHMENTS_JANITOR_JOB, ATTACHMENTS_QUEUE } from './constants';

/**
 * Sweeps orphan PENDING attachments — rows that were signed but never
 * confirmed. Runs every 5 minutes (repeatable job); each sweep drops rows
 * older than 15 minutes and asks the storage adapter to remove any residue.
 *
 * Registration is idempotent per (job name + pattern) so multiple API
 * instances calling this at boot only insert one repeatable definition.
 * A short timeout wraps the registration so a Redis outage cannot hang boot
 * — same pattern used by CleanupProcessor.
 */
@Injectable()
@Processor(ATTACHMENTS_QUEUE)
export class AttachmentsJanitorProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AttachmentsJanitorProcessor.name);
  private readonly staleThresholdMs = 15 * 60 * 1000;

  constructor(
    private readonly attachments: AttachmentsService,
    private readonly config: ConfigService,
    @InjectQueue(ATTACHMENTS_QUEUE) private readonly queue: Queue,
    private readonly cls: ClsService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const bootTimeoutMs = this.config.get<number>('ATTACHMENTS_JANITOR_REGISTER_TIMEOUT_MS', 2000);
    try {
      await Promise.race([
        this.queue.add(ATTACHMENTS_JANITOR_JOB, withJobTelemetry({}), {
          // Every 5 minutes.
          repeat: { pattern: '*/5 * * * *' },
          removeOnComplete: 100,
          removeOnFail: 100,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`register attachments janitor job timed out after ${bootTimeoutMs}ms`),
              ),
            bootTimeoutMs,
          ),
        ),
      ]);
      this.logger.log('Attachments janitor repeatable job registered');
    } catch (err) {
      this.logger.warn(
        { err },
        'Failed to register attachments janitor at boot — will retry on next boot',
      );
    }
  }

  async process(job: Job): Promise<{ swept: number }> {
    return runInJobContext(job, this.cls, `process.${ATTACHMENTS_QUEUE}.${job.name}`, async () => {
      const cutoff = new Date(Date.now() - this.staleThresholdMs);
      const result = await this.attachments.sweepOrphanPending(cutoff);
      if (result.swept > 0) {
        this.logger.log({ swept: result.swept }, 'attachments.janitor.swept');
      }
      return result;
    });
  }
}
