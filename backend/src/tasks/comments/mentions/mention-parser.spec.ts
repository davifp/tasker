import { describe, it, expect } from 'vitest';
import { MentionParser } from './mention-parser';

describe('MentionParser.extract', () => {
  const parser = new MentionParser();

  it('captures a handle at the start of the body', () => {
    const out = parser.extract('@alice hi');
    expect(out).toEqual([{ handle: 'alice', offset: 0 }]);
  });

  it('captures a handle after whitespace', () => {
    const out = parser.extract('please review @bob thanks');
    expect(out.map(m => m.handle)).toEqual(['bob']);
  });

  it('supports underscore and dot in handles', () => {
    const out = parser.extract('cc @ana.silva and @dev_ops');
    expect(out.map(m => m.handle)).toEqual(['ana.silva', 'dev_ops']);
  });

  it('does NOT match an email-style @', () => {
    const out = parser.extract('contact me@example.com about this');
    expect(out).toEqual([]);
  });

  it('does NOT match escaped @', () => {
    const out = parser.extract('use \\@alice literally');
    expect(out).toEqual([]);
  });

  it('does NOT match inside fenced code blocks', () => {
    const src = '```\nping @alice\n```\ncc @bob';
    const out = parser.extract(src);
    expect(out.map(m => m.handle)).toEqual(['bob']);
  });

  it('does NOT match inside tilde-fenced code blocks', () => {
    const src = '~~~\nping @alice\n~~~\ncc @bob';
    const out = parser.extract(src);
    expect(out.map(m => m.handle)).toEqual(['bob']);
  });

  it('does NOT match inside inline code', () => {
    const out = parser.extract('the token is `@literal` here');
    expect(out).toEqual([]);
  });

  it('captures once when the same handle appears multiple times', () => {
    const out = parser.extract('hey @alice again @alice thanks');
    expect(out.map(m => m.handle)).toEqual(['alice']);
  });

  it('dedupes case-insensitively', () => {
    const out = parser.extract('@Alice @alice');
    expect(out.map(m => m.handle)).toEqual(['Alice']);
  });

  it('records the offset of the @ character', () => {
    const src = 'hello @world';
    const out = parser.extract(src);
    expect(out[0]).toEqual({ handle: 'world', offset: 6 });
  });

  it('matches after `(` and `>` triggers', () => {
    expect(parser.extract('cc (@alice)').map(m => m.handle)).toEqual(['alice']);
    expect(parser.extract('> @bob quoted').map(m => m.handle)).toEqual(['bob']);
  });

  it('caps handle length at 64', () => {
    const long = 'a'.repeat(80);
    const out = parser.extract(`@${long}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.handle).toHaveLength(64);
  });

  it('handles bare @ with no handle following', () => {
    expect(parser.extract('just @ alone')).toEqual([]);
  });

  it('returns [] for empty body', () => {
    expect(parser.extract('')).toEqual([]);
  });
});
