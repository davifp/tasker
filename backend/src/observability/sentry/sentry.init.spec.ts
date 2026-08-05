import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { __resetSentryForTests, startSentry } from './sentry.init';

vi.mock('@sentry/node', async () => {
  return {
    init: vi.fn(),
    withScope: vi.fn(),
    captureException: vi.fn(),
  };
});

beforeEach(() => {
  __resetSentryForTests();
  vi.mocked(Sentry.init).mockReset();
});

describe('startSentry', () => {
  it('is a no-op when DSN is empty (dev/test/CI without a real project)', () => {
    startSentry({
      dsn: '',
      environment: 'test',
      release: 'v1',
      tracesSampleRate: 0.1,
      service: 'tasker-api',
    });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialises with the expected core options when DSN is set', () => {
    startSentry({
      dsn: 'https://key@o1.ingest.us.sentry.io/123',
      environment: 'production',
      release: 'v1-abc',
      tracesSampleRate: 0.25,
      service: 'tasker-api',
    });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    expect(opts.dsn).toBe('https://key@o1.ingest.us.sentry.io/123');
    expect(opts.environment).toBe('production');
    expect(opts.release).toBe('v1-abc');
    expect(opts.dist).toBe('tasker-api');
    expect(opts.tracesSampleRate).toBe(0.25);
    expect(typeof opts.beforeSend).toBe('function');
  });

  it('is idempotent — a second call after a real init does nothing', () => {
    const c = {
      dsn: 'https://key@o1.ingest.us.sentry.io/123',
      environment: 'production',
      release: 'v1',
      tracesSampleRate: 0.1,
      service: 'tasker-api',
    };
    startSentry(c);
    startSentry(c);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});

describe('beforeSend filter', () => {
  function buildBeforeSend() {
    startSentry({
      dsn: 'https://key@o1.ingest.us.sentry.io/123',
      environment: 'test',
      release: 'v1',
      tracesSampleRate: 0,
      service: 'tasker-api',
    });
    const opts = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    return opts.beforeSend as (event: Sentry.ErrorEvent) => Sentry.ErrorEvent | null;
  }

  it('drops expected 4xx statuses (400, 401, 403, 404, 409, 422, 429)', () => {
    const beforeSend = buildBeforeSend();
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      const event = {
        contexts: { response: { status_code: status } },
        exception: { values: [{ type: 'HttpException' }] },
      } as unknown as Sentry.ErrorEvent;
      expect(beforeSend(event)).toBeNull();
    }
  });

  it('forwards 5xx events through', () => {
    const beforeSend = buildBeforeSend();
    const event = {
      contexts: { response: { status_code: 500 } },
      exception: { values: [{ type: 'Error' }] },
    } as unknown as Sentry.ErrorEvent;
    expect(beforeSend(event)).toBe(event);
  });

  it('rate-limits a runaway fingerprint after the 100/hour threshold', () => {
    const beforeSend = buildBeforeSend();
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: { frames: [{ filename: 'foo.ts', function: 'bar' }] },
          },
        ],
      },
    } as unknown as Sentry.ErrorEvent;
    let sent = 0;
    for (let i = 0; i < 150; i++) {
      if (beforeSend({ ...event })) sent += 1;
    }
    expect(sent).toBe(100);
  });

  it('separately rate-limits distinct fingerprints', () => {
    const beforeSend = buildBeforeSend();
    const eventA = {
      exception: {
        values: [{ type: 'Error', stacktrace: { frames: [{ filename: 'a.ts', function: 'x' }] } }],
      },
    } as unknown as Sentry.ErrorEvent;
    const eventB = {
      exception: {
        values: [{ type: 'Error', stacktrace: { frames: [{ filename: 'b.ts', function: 'y' }] } }],
      },
    } as unknown as Sentry.ErrorEvent;
    for (let i = 0; i < 105; i++) beforeSend(eventA);
    // A is now rate-limited, but B should still pass on first hit.
    expect(beforeSend(eventB)).toBe(eventB);
  });
});
