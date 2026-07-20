import { describe, expect, it } from 'vitest';
import { resolveLandingView } from './resolveLandingView';

describe('resolveLandingView', () => {
  it('returns the URL view when it is a valid name', () => {
    expect(
      resolveLandingView({ urlView: 'timeline', serverDefaultView: 'list' }),
    ).toBe('timeline');
  });

  it('falls back to the server default when the URL view is absent', () => {
    expect(
      resolveLandingView({ urlView: null, serverDefaultView: 'list' }),
    ).toBe('list');
  });

  it('falls back to the server default when the URL view is unknown', () => {
    expect(
      resolveLandingView({ urlView: 'invalid', serverDefaultView: 'calendar' }),
    ).toBe('calendar');
  });

  it('defaults to board when neither URL nor server default is set', () => {
    expect(
      resolveLandingView({ urlView: null, serverDefaultView: null }),
    ).toBe('board');
  });

  it('defaults to board when the server default is unknown', () => {
    // Widened `string | null` signature lets us hand a raw payload
    // straight in; the guard rejects anything outside the ViewName set.
    expect(
      resolveLandingView({ urlView: null, serverDefaultView: 'garbage' }),
    ).toBe('board');
  });

  it('URL wins over server default', () => {
    expect(
      resolveLandingView({ urlView: 'backlog', serverDefaultView: 'timeline' }),
    ).toBe('backlog');
  });
});
