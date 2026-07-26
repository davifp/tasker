import { describe, it, expect } from 'vitest';
import { fromUrl, toUrl } from './auditParams';

describe('auditParams', () => {
  it('parses comma-separated event/targetType lists', () => {
    const parsed = fromUrl(new URLSearchParams('event=a,b&targetType=task'));
    expect(parsed.event).toEqual(['a', 'b']);
    expect(parsed.targetType).toEqual(['task']);
  });

  it('round-trips filters through toUrl → fromUrl', () => {
    const params = {
      actorUserId: 'user-9',
      event: ['task.created', 'task.updated'],
      targetType: ['task'],
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 50,
    };
    const url = toUrl(params);
    const back = fromUrl(new URLSearchParams(url));
    expect(back.actorUserId).toBe(params.actorUserId);
    expect([...(back.event ?? [])]).toEqual(params.event);
    expect(back.from).toBe(params.from);
    expect(back.to).toBe(params.to);
  });

  it('omits empty filter sets', () => {
    const url = toUrl({ limit: 50 });
    expect(url).toBe('');
  });

  it('accepts Next.js record-shaped searchParams', () => {
    const parsed = fromUrl({ event: 'task.created', actorUserId: 'u-1' });
    expect(parsed.event).toEqual(['task.created']);
    expect(parsed.actorUserId).toBe('u-1');
  });
});
