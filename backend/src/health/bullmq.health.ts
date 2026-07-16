import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { CLEANUP_QUEUE, MAIL_QUEUE } from '../queues/constants';

interface QueueSnapshot {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: boolean;
}

// Reports queue depth for the `mail` and `cleanup` queues. Degraded state
// (queue paused or waiting depth above threshold) surfaces as a
// HealthCheckError so Terminus returns 503 problem+json — used by orchestrators
// to route traffic away from a node whose workers can't keep up.
@Injectable()
export class BullMqHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    @InjectQueue(CLEANUP_QUEUE) private readonly cleanupQueue: Queue,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const maxWaiting = this.config.get<number>('BULLMQ_HEALTH_MAX_WAITING', 1000);
    const timeoutMs = this.config.get<number>('BULLMQ_HEALTH_TIMEOUT_MS', 2000);

    let mail: QueueSnapshot;
    let cleanup: QueueSnapshot;
    try {
      [mail, cleanup] = await withTimeout(
        Promise.all([this.snapshot(this.mailQueue), this.snapshot(this.cleanupQueue)]),
        timeoutMs,
      );
    } catch (err) {
      // Redis unreachable / queue introspection stalled — surface as degraded so
      // the health check completes quickly instead of hanging on BullMQ's retry.
      throw new HealthCheckError('BullMQ queues unreachable', {
        [key]: { status: 'down', detail: (err as Error).message },
      });
    }

    const problems: string[] = [];
    for (const [name, snap] of [[MAIL_QUEUE, mail] as const, [CLEANUP_QUEUE, cleanup] as const]) {
      if (snap.paused) problems.push(`${name} queue is paused`);
      if (snap.waiting > maxWaiting) {
        problems.push(`${name} queue waiting=${snap.waiting} exceeds ${maxWaiting}`);
      }
    }

    const payload: HealthIndicatorResult = this.getStatus(key, problems.length === 0, {
      mail,
      cleanup,
    });

    if (problems.length > 0) {
      throw new HealthCheckError('BullMQ queues degraded', {
        ...payload,
        [key]: { ...payload[key], detail: problems.join('; ') },
      });
    }

    return payload;
  }

  private async snapshot(queue: Queue): Promise<QueueSnapshot> {
    const [counts, paused] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      queue.isPaused(),
    ]);
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      paused,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`BullMQ health check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
