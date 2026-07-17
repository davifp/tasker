import { describe, it, expect } from 'vitest';
import { parseWorkspaceCookieValue } from './workspace';

describe('parseWorkspaceCookieValue', () => {
  it('parses a valid workspace cookie into an object', () => {
    const raw = JSON.stringify({ id: 'ws-1', slug: 'acme' });
    expect(parseWorkspaceCookieValue(raw)).toEqual({ id: 'ws-1', slug: 'acme' });
  });

  it('returns null when the cookie is missing id or slug', () => {
    expect(parseWorkspaceCookieValue(JSON.stringify({ id: 'ws-1' }))).toBeNull();
    expect(parseWorkspaceCookieValue(JSON.stringify({ slug: 'acme' }))).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseWorkspaceCookieValue('{"id":')).toBeNull();
  });

  it('returns null when input is undefined or empty', () => {
    expect(parseWorkspaceCookieValue(undefined)).toBeNull();
    expect(parseWorkspaceCookieValue('')).toBeNull();
  });
});
