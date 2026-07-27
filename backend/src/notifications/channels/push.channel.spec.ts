import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PushSubscriptionsService } from '../../push/push-subscriptions.service';
import type { BufferedEmailItem } from './email.channel';
import { PushChannel, scrubPushPayload } from './push.channel';

// web-push is a network-side effect; the mock is hoisted so PushChannel
// picks it up on import. Both the spies and the error class must live
// inside the hoisted block — `vi.hoisted` cannot reach top-level class
// declarations because the mock factory runs before those bindings exist.
const { sendNotification, setVapidDetails, FakeWebPushError } = vi.hoisted(() => {
  class FakeWebPushError extends Error {
    statusCode: number;
    constructor(statusCode: number) {
      super(`webpush ${statusCode}`);
      this.statusCode = statusCode;
    }
  }
  return {
    sendNotification: vi.fn(),
    setVapidDetails: vi.fn(),
    FakeWebPushError,
  };
});
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
  WebPushError: FakeWebPushError,
}));

function makeItem(overrides?: Partial<BufferedEmailItem>): BufferedEmailItem {
  return {
    notificationId: 'n-1',
    workspaceId: 'ws-1',
    eventType: 'COMMENT_MENTION',
    sourceKind: 'COMMENT',
    sourceId: 'c-1',
    idempotencyKey: 'k',
    payload: { actorDisplayName: 'Ana', taskTitle: 'Ship it', workspaceSlug: 'acme' },
    bufferedAt: '2026-07-27T12:00:00Z',
    ...overrides,
  };
}

function makeChannel(overrides?: {
  rows?: Array<{ id: string; endpoint: string; p256dh: string; authKey: string; lastSeenAt: Date }>;
  configured?: boolean;
}) {
  const listForUser = vi
    .fn()
    .mockResolvedValue(
      overrides?.rows ?? [
        {
          id: 's-1',
          endpoint: 'https://push/endpoint-1',
          p256dh: 'p1',
          authKey: 'a1',
          lastSeenAt: new Date(),
        },
      ],
    );
  const deleteByEndpoint = vi.fn().mockResolvedValue({ deleted: 1 });
  const touchLastSeen = vi.fn().mockResolvedValue(undefined);
  const subs = {
    listForUser,
    deleteByEndpoint,
    touchLastSeen,
  } as unknown as PushSubscriptionsService;
  const configured = overrides?.configured ?? true;
  const config = {
    get: (key: string, fallback: unknown) => {
      if (key === 'APP_BASE_URL') return 'https://tasker.dev';
      if (key === 'VAPID_PUBLIC_KEY') return configured ? 'pub' : undefined;
      if (key === 'VAPID_PRIVATE_KEY') return configured ? 'priv' : undefined;
      if (key === 'VAPID_SUBJECT') return 'mailto:noreply@tasker.dev';
      return fallback;
    },
  } as unknown as ConfigService;
  return { channel: new PushChannel(config, subs), listForUser, deleteByEndpoint, touchLastSeen };
}

describe('scrubPushPayload', () => {
  it('produces only the allowlisted wire fields', () => {
    const payload = scrubPushPayload(
      {
        eventType: 'COMMENT_MENTION',
        notificationId: 'n-1',
        payload: { actorDisplayName: 'Ana', taskTitle: 'Ship' },
      },
      'https://tasker.dev/acme/notifications',
    );
    expect(Object.keys(payload).sort()).toEqual(
      ['body', 'eventType', 'notificationId', 'title', 'url'].sort(),
    );
  });
});

describe('PushChannel.send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers to every subscription and touches lastSeen on success', async () => {
    const { channel, touchLastSeen } = makeChannel({
      rows: [
        {
          id: 's-1',
          endpoint: 'https://push/1',
          p256dh: 'p1',
          authKey: 'a1',
          lastSeenAt: new Date(),
        },
        {
          id: 's-2',
          endpoint: 'https://push/2',
          p256dh: 'p2',
          authKey: 'a2',
          lastSeenAt: new Date(),
        },
      ],
    });
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const result = await channel.send('user-a', makeItem());
    expect(result.delivered).toBe(2);
    expect(touchLastSeen).toHaveBeenCalledTimes(2);
  });

  it('deletes the subscription on a 410 Gone', async () => {
    const { channel, deleteByEndpoint } = makeChannel();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(410));
    const result = await channel.send('user-a', makeItem());
    expect(result.delivered).toBe(0);
    expect(deleteByEndpoint).toHaveBeenCalledWith('https://push/endpoint-1');
  });

  it('deletes the subscription on a 404 Not Found', async () => {
    const { channel, deleteByEndpoint } = makeChannel();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(404));
    await channel.send('user-a', makeItem());
    expect(deleteByEndpoint).toHaveBeenCalled();
  });

  it('does not delete on transient 5xx', async () => {
    const { channel, deleteByEndpoint } = makeChannel();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(500));
    await channel.send('user-a', makeItem());
    expect(deleteByEndpoint).not.toHaveBeenCalled();
  });

  it('is a no-op when VAPID keys are missing', async () => {
    const { channel, listForUser } = makeChannel({ configured: false });
    const result = await channel.send('user-a', makeItem());
    expect(result.delivered).toBe(0);
    expect(listForUser).not.toHaveBeenCalled();
  });

  it('is a no-op when the user has no active subscriptions', async () => {
    const { channel } = makeChannel({ rows: [] });
    const result = await channel.send('user-a', makeItem());
    expect(result.delivered).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
