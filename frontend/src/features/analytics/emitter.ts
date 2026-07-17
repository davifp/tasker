import { z } from 'zod';

const provider = z.enum(['local', 'google', 'github']);

export const AnalyticsEventSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('signup_started'), provider }),
  z.object({ name: z.literal('signup_completed'), provider }),
  z.object({ name: z.literal('login_completed'), provider }),
  z.object({ name: z.literal('workspace_created'), workspaceId: z.string().min(1) }),
  z.object({
    name: z.literal('invite_sent'),
    workspaceId: z.string().min(1),
    count: z.number().int().min(1).max(10),
  }),
  z.object({ name: z.literal('member_removed'), workspaceId: z.string().min(1) }),
  z.object({ name: z.literal('error_boundary'), digest: z.string().optional() }),
]);
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsBatchSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(50),
});
export type AnalyticsBatch = z.infer<typeof AnalyticsBatchSchema>;

export interface AnalyticsClient {
  emit(event: AnalyticsEvent): void;
  flush(): Promise<void>;
}

export interface AnalyticsClientOptions {
  post?: (batch: AnalyticsBatch) => Promise<void>;
  flushIntervalMs?: number;
  batchSize?: number;
  maxRetries?: number;
}

const DEFAULT_INTERVAL = 2000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_RETRIES = 2;

async function defaultPost(batch: AnalyticsBatch): Promise<void> {
  const response = await fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(batch),
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`analytics-post-failed:${response.status}`);
  }
}

export function createAnalyticsClient(options: AnalyticsClientOptions = {}): AnalyticsClient {
  const post = options.post ?? defaultPost;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_INTERVAL;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_RETRIES;

  const queue: AnalyticsEvent[] = [];
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  function schedule() {
    if (scheduled || inFlight) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      void flush();
    }, flushIntervalMs);
  }

  async function attemptOnce(events: AnalyticsEvent[]): Promise<boolean> {
    try {
      await post({ events });
      return true;
    } catch {
      return false;
    }
  }

  async function flush(): Promise<void> {
    if (inFlight || queue.length === 0) return;
    inFlight = true;
    try {
      while (queue.length > 0) {
        const chunk = queue.splice(0, batchSize);
        let attempts = 0;
        let sent = false;
        while (!sent && attempts <= maxRetries) {
          sent = await attemptOnce(chunk);
          if (!sent) attempts += 1;
        }
        if (!sent) {
          queue.unshift(...chunk);
          break;
        }
      }
    } finally {
      inFlight = false;
      if (queue.length > 0) schedule();
    }
  }

  return {
    emit(event) {
      queue.push(event);
      if (queue.length >= batchSize) {
        void flush();
      } else {
        schedule();
      }
    },
    flush,
  };
}
