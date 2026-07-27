import { describe, it, expect } from 'vitest';
import {
  notificationChannelSchema,
  notificationEventTypeSchema,
  notificationSourceKindSchema,
  realtimeEventSchema,
  subscribeTaskMessageSchema,
  realtimeTicketClaimsSchema,
} from './schemas';

describe('notification catalog enums', () => {
  it('accepts every notification event type', () => {
    for (const value of [
      'COMMENT_MENTION',
      'TASK_ASSIGNED',
      'COMMENT_FOLLOWED',
      'SPRINT_LIFECYCLE',
    ]) {
      expect(notificationEventTypeSchema.parse(value)).toBe(value);
    }
  });

  it('rejects an unknown notification event type', () => {
    expect(() => notificationEventTypeSchema.parse('comment.mention')).toThrow();
  });

  it('accepts every notification channel', () => {
    for (const value of ['IN_APP', 'EMAIL', 'PUSH']) {
      expect(notificationChannelSchema.parse(value)).toBe(value);
    }
  });

  it('rejects an unknown notification channel', () => {
    expect(() => notificationChannelSchema.parse('sms')).toThrow();
  });

  it('accepts every notification source kind', () => {
    for (const value of ['TASK', 'COMMENT', 'SPRINT']) {
      expect(notificationSourceKindSchema.parse(value)).toBe(value);
    }
  });
});

describe('realtimeEventSchema', () => {
  it('accepts a task.updated event', () => {
    const event = {
      type: 'task.updated' as const,
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: { status: 'DONE' },
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('accepts a task.moved event with an empty payload', () => {
    const event = {
      type: 'task.moved' as const,
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: {},
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('accepts a comment.created event', () => {
    const event = {
      type: 'comment.created' as const,
      workspaceId: 'ws-1',
      taskId: 't-1',
      commentId: 'c-1',
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('accepts an activity.added event', () => {
    const event = {
      type: 'activity.added' as const,
      workspaceId: 'ws-1',
      taskId: 't-1',
      entryId: 'a-1',
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('accepts a sprint.updated event with a valid state', () => {
    const event = {
      type: 'sprint.updated' as const,
      workspaceId: 'ws-1',
      sprintId: 's-1',
      state: 'ACTIVE' as const,
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('rejects a sprint.updated event with an invalid state', () => {
    expect(() =>
      realtimeEventSchema.parse({
        type: 'sprint.updated',
        workspaceId: 'ws-1',
        sprintId: 's-1',
        state: 'CANCELLED',
      }),
    ).toThrow();
  });

  it('accepts a notification.new event', () => {
    const event = {
      type: 'notification.new' as const,
      workspaceId: 'ws-1',
      recipientUserId: 'u-1',
      notificationId: 'n-1',
    };
    expect(realtimeEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown event type', () => {
    expect(() => realtimeEventSchema.parse({ type: 'user.online', workspaceId: 'ws-1' })).toThrow();
  });

  it('rejects an event with a blank id', () => {
    expect(() =>
      realtimeEventSchema.parse({
        type: 'notification.new',
        workspaceId: '',
        recipientUserId: 'u-1',
        notificationId: 'n-1',
      }),
    ).toThrow();
  });
});

describe('subscribeTaskMessageSchema', () => {
  it('accepts a valid taskId', () => {
    expect(subscribeTaskMessageSchema.parse({ taskId: 't-1' })).toEqual({ taskId: 't-1' });
  });

  it('rejects an empty taskId', () => {
    expect(() => subscribeTaskMessageSchema.parse({ taskId: '' })).toThrow();
  });
});

describe('realtimeTicketClaimsSchema', () => {
  const validClaims = {
    sub: 'user-1',
    jti: 'jti-abc',
    aud: 'rt-ticket' as const,
    iat: 1_700_000_000,
    exp: 1_700_000_060,
  };

  it('accepts well-formed claims', () => {
    expect(realtimeTicketClaimsSchema.parse(validClaims)).toEqual(validClaims);
  });

  it('rejects a wrong audience', () => {
    expect(() => realtimeTicketClaimsSchema.parse({ ...validClaims, aud: 'access' })).toThrow();
  });

  it('rejects a non-integer exp', () => {
    expect(() => realtimeTicketClaimsSchema.parse({ ...validClaims, exp: 1.5 })).toThrow();
  });
});
