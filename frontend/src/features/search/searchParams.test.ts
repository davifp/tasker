import { describe, it, expect } from 'vitest';
import { fromUrl, toUrl } from './searchParams';

describe('searchParams', () => {
  it('parses q from URLSearchParams', () => {
    const sp = new URLSearchParams('q=hello');
    expect(fromUrl(sp).q).toBe('hello');
  });

  it('parses type as comma-separated list, filtering unknown values', () => {
    const sp = new URLSearchParams('q=x&type=task,project,bogus');
    expect(fromUrl(sp).type).toEqual(['task', 'project']);
  });

  it('omits type entirely when the URL contains no valid values', () => {
    const sp = new URLSearchParams('q=x&type=bogus');
    expect(fromUrl(sp).type).toBeUndefined();
  });

  it('round-trips filters through toUrl → fromUrl', () => {
    const params = {
      q: 'widget',
      type: ['task' as const, 'sprint' as const],
      projectId: 'proj-1',
      authorUserId: 'user-9',
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 20,
    };
    const url = toUrl(params);
    const back = fromUrl(new URLSearchParams(url));
    expect(back.q).toBe(params.q);
    expect([...(back.type ?? [])].sort()).toEqual([...params.type].sort());
    expect(back.projectId).toBe(params.projectId);
    expect(back.authorUserId).toBe(params.authorUserId);
    expect(back.from).toBe(params.from);
    expect(back.to).toBe(params.to);
  });

  it('accepts a plain record (Next.js searchParams shape)', () => {
    const parsed = fromUrl({ q: 'x', type: 'task' });
    expect(parsed.q).toBe('x');
    expect(parsed.type).toEqual(['task']);
  });
});
