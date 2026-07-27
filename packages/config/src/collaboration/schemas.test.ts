import { describe, it, expect } from 'vitest';
import {
  createCommentSchema,
  updateCommentSchema,
  listCommentsQuerySchema,
  reactionEmojiSchema,
  reactionParamSchema,
  mentionAutocompleteQuerySchema,
  signAttachmentSchema,
  listAttachmentsQuerySchema,
  activityVerbSchema,
  listActivityQuerySchema,
  notificationJobSchema,
  MENTION_HANDLE_REGEXP,
} from './schemas';
import { ATTACHMENT_MAX_BYTES } from './attachment-policy';

describe('createCommentSchema', () => {
  it('accepts a well-formed body', () => {
    expect(createCommentSchema.parse({ body: 'Hello world' })).toEqual({ body: 'Hello world' });
  });

  it('trims and rejects empty body', () => {
    expect(() => createCommentSchema.parse({ body: '   ' })).toThrow();
  });

  it('rejects body over 10_000 characters', () => {
    expect(() => createCommentSchema.parse({ body: 'a'.repeat(10_001) })).toThrow();
  });
});

describe('updateCommentSchema', () => {
  it('accepts a well-formed body', () => {
    expect(updateCommentSchema.parse({ body: 'edited' })).toEqual({ body: 'edited' });
  });
});

describe('listCommentsQuerySchema', () => {
  it('applies default limit', () => {
    const parsed = listCommentsQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
  });

  it('coerces limit strings to numbers', () => {
    const parsed = listCommentsQuerySchema.parse({ limit: '25' });
    expect(parsed.limit).toBe(25);
  });

  it('rejects limit above the cap', () => {
    expect(() => listCommentsQuerySchema.parse({ limit: '200' })).toThrow();
  });
});

describe('reactionEmojiSchema', () => {
  it('accepts every catalog entry', () => {
    for (const emoji of [
      'thumbs_up',
      'heart',
      'tada',
      'rocket',
      'eyes',
      'check',
      'thinking',
      'thumbs_down',
    ]) {
      expect(reactionEmojiSchema.parse(emoji)).toBe(emoji);
    }
  });

  it('rejects an unknown emoji (per PRD FR-13/14)', () => {
    expect(() => reactionEmojiSchema.parse('poop')).toThrow();
  });

  it('rejects a look-alike casing', () => {
    expect(() => reactionEmojiSchema.parse('Thumbs_up')).toThrow();
  });

  it('is exposed as a param object schema too', () => {
    expect(reactionParamSchema.parse({ emoji: 'heart' })).toEqual({ emoji: 'heart' });
  });
});

describe('mentionAutocompleteQuerySchema', () => {
  it('defaults to empty q and 10 results', () => {
    const parsed = mentionAutocompleteQuerySchema.parse({});
    expect(parsed).toEqual({ q: '', limit: 10 });
  });

  it('caps limit at 25', () => {
    expect(() => mentionAutocompleteQuerySchema.parse({ limit: '100' })).toThrow();
  });

  it('rejects an oversized q', () => {
    expect(() => mentionAutocompleteQuerySchema.parse({ q: 'x'.repeat(65) })).toThrow();
  });
});

describe('MENTION_HANDLE_REGEXP', () => {
  it('captures a handle at the start of a line', () => {
    const src = '@alice hi';
    MENTION_HANDLE_REGEXP.lastIndex = 0;
    const match = MENTION_HANDLE_REGEXP.exec(src);
    expect(match?.[1]).toBe('alice');
  });

  it('captures a handle after whitespace', () => {
    const src = 'ping @bob please';
    MENTION_HANDLE_REGEXP.lastIndex = 0;
    const match = MENTION_HANDLE_REGEXP.exec(src);
    expect(match?.[1]).toBe('bob');
  });

  it('does not capture an email-style @', () => {
    const src = 'contact me@example.com';
    MENTION_HANDLE_REGEXP.lastIndex = 0;
    const match = MENTION_HANDLE_REGEXP.exec(src);
    expect(match).toBeNull();
  });
});

describe('signAttachmentSchema', () => {
  const valid = {
    filename: 'evidence.png',
    mime: 'image/png',
    sizeBytes: 1024,
  };

  it('accepts a well-formed request', () => {
    expect(signAttachmentSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a disallowed mime (per PRD FR-16)', () => {
    expect(() =>
      signAttachmentSchema.parse({ ...valid, mime: 'application/x-msdownload' }),
    ).toThrow();
  });

  it('rejects sizeBytes above the 25 MB cap (per PRD FR-16 edge case)', () => {
    expect(() =>
      signAttachmentSchema.parse({ ...valid, sizeBytes: ATTACHMENT_MAX_BYTES + 1 }),
    ).toThrow();
  });

  it('rejects zero or negative sizes', () => {
    expect(() => signAttachmentSchema.parse({ ...valid, sizeBytes: 0 })).toThrow();
    expect(() => signAttachmentSchema.parse({ ...valid, sizeBytes: -1 })).toThrow();
  });

  it('rejects a filename with path traversal', () => {
    expect(() => signAttachmentSchema.parse({ ...valid, filename: '../secret.png' })).toThrow();
  });

  it('rejects a filename with a NUL byte', () => {
    expect(() => signAttachmentSchema.parse({ ...valid, filename: 'a\0b.png' })).toThrow();
  });

  it('rejects an empty filename', () => {
    expect(() => signAttachmentSchema.parse({ ...valid, filename: '   ' })).toThrow();
  });
});

describe('listAttachmentsQuerySchema', () => {
  it('defaults limit to 50', () => {
    expect(listAttachmentsQuerySchema.parse({}).limit).toBe(50);
  });
});

describe('activityVerbSchema', () => {
  it('accepts every documented verb', () => {
    for (const verb of [
      'task.created',
      'task.updated',
      'task.deleted',
      'task.status_changed',
      'comment.created',
      'comment.edited',
      'comment.deleted',
      'reaction.added',
      'reaction.removed',
      'attachment.uploaded',
      'attachment.removed',
    ]) {
      expect(activityVerbSchema.parse(verb)).toBe(verb);
    }
  });

  it('rejects an unknown verb', () => {
    expect(() => activityVerbSchema.parse('mystery.happened')).toThrow();
  });
});

describe('listActivityQuerySchema', () => {
  it('defaults limit to 50', () => {
    expect(listActivityQuerySchema.parse({}).limit).toBe(50);
  });
});

describe('notificationJobSchema', () => {
  const validMention = {
    type: 'comment.mention' as const,
    workspaceId: 'ws-1',
    commentId: 'c-1',
    taskId: 't-1',
    mentionedUserId: 'u-1',
    actorUserId: 'u-2',
  };

  it('accepts a well-formed legacy mention job', () => {
    expect(notificationJobSchema.parse(validMention)).toEqual(validMention);
  });

  it('rejects a job with an unknown discriminator', () => {
    expect(() => notificationJobSchema.parse({ ...validMention, type: 'comment.reply' })).toThrow();
  });

  it('rejects a mention job with an empty required id', () => {
    expect(() => notificationJobSchema.parse({ ...validMention, mentionedUserId: '' })).toThrow();
  });

  it('accepts a fan-out job with all required fields', () => {
    const job = {
      type: 'notification.fanout' as const,
      workspaceId: 'ws-1',
      eventType: 'COMMENT_MENTION' as const,
      recipientUserId: 'u-1',
      notificationId: 'n-1',
      sourceKind: 'COMMENT' as const,
      sourceId: 'c-1',
      actorUserId: 'u-2',
    };
    expect(notificationJobSchema.parse(job)).toEqual(job);
  });

  it('accepts a fan-out job without an actor (system-emitted)', () => {
    const job = {
      type: 'notification.fanout' as const,
      workspaceId: 'ws-1',
      eventType: 'SPRINT_LIFECYCLE' as const,
      recipientUserId: 'u-1',
      notificationId: 'n-1',
      sourceKind: 'SPRINT' as const,
      sourceId: 's-1',
    };
    expect(notificationJobSchema.parse(job)).toEqual(job);
  });

  it('rejects a fan-out job with an unknown eventType', () => {
    expect(() =>
      notificationJobSchema.parse({
        type: 'notification.fanout',
        workspaceId: 'ws-1',
        eventType: 'comment.mention',
        recipientUserId: 'u-1',
        notificationId: 'n-1',
        sourceKind: 'COMMENT',
        sourceId: 'c-1',
      }),
    ).toThrow();
  });

  it('accepts an email-batch scan job (no recipient)', () => {
    expect(notificationJobSchema.parse({ type: 'notification.email-batch' })).toEqual({
      type: 'notification.email-batch',
    });
  });

  it('accepts an email-batch job targeted at a recipient', () => {
    expect(
      notificationJobSchema.parse({ type: 'notification.email-batch', recipientUserId: 'u-1' }),
    ).toEqual({ type: 'notification.email-batch', recipientUserId: 'u-1' });
  });

  it('accepts a push job with all required fields', () => {
    const job = {
      type: 'notification.push' as const,
      workspaceId: 'ws-1',
      recipientUserId: 'u-1',
      notificationId: 'n-1',
    };
    expect(notificationJobSchema.parse(job)).toEqual(job);
  });

  it('rejects a push job with a missing notificationId', () => {
    expect(() =>
      notificationJobSchema.parse({
        type: 'notification.push',
        workspaceId: 'ws-1',
        recipientUserId: 'u-1',
      }),
    ).toThrow();
  });
});
