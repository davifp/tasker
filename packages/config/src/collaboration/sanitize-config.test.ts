import { describe, it, expect } from 'vitest';
import {
  SanitizeConfig,
  SANITIZE_ALLOWED_TAGS,
  SANITIZE_ALLOWED_ATTR,
  SANITIZE_ALLOWED_URI_REGEXP,
} from './sanitize-config';

describe('SANITIZE_ALLOWED_TAGS', () => {
  it('permits Markdown block-level and inline tags', () => {
    for (const t of ['p', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'strong', 'em']) {
      expect(SANITIZE_ALLOWED_TAGS).toContain(t);
    }
  });

  it('does not permit script/iframe/style tags (XSS vectors)', () => {
    expect(SANITIZE_ALLOWED_TAGS).not.toContain('script');
    expect(SANITIZE_ALLOWED_TAGS).not.toContain('iframe');
    expect(SANITIZE_ALLOWED_TAGS).not.toContain('style');
  });
});

describe('SANITIZE_ALLOWED_ATTR', () => {
  it('permits href/src/alt/title/target/rel', () => {
    for (const a of ['href', 'src', 'alt', 'title', 'target', 'rel']) {
      expect(SANITIZE_ALLOWED_ATTR).toContain(a);
    }
  });

  it('does not permit event-handler attributes', () => {
    expect(SANITIZE_ALLOWED_ATTR).not.toContain('onerror');
    expect(SANITIZE_ALLOWED_ATTR).not.toContain('onclick');
    expect(SANITIZE_ALLOWED_ATTR).not.toContain('onload');
  });
});

describe('SANITIZE_ALLOWED_URI_REGEXP', () => {
  it('accepts http and https', () => {
    expect(SANITIZE_ALLOWED_URI_REGEXP.test('http://example.com')).toBe(true);
    expect(SANITIZE_ALLOWED_URI_REGEXP.test('https://example.com')).toBe(true);
  });

  it('accepts mailto', () => {
    expect(SANITIZE_ALLOWED_URI_REGEXP.test('mailto:a@b.com')).toBe(true);
  });

  it('rejects javascript: URLs (primary XSS vector)', () => {
    expect(SANITIZE_ALLOWED_URI_REGEXP.test('javascript:alert(1)')).toBe(false);
  });

  it('rejects vbscript: URLs', () => {
    expect(SANITIZE_ALLOWED_URI_REGEXP.test('vbscript:msgbox(1)')).toBe(false);
  });
});

describe('SanitizeConfig', () => {
  it('exposes forbidden tags including script and iframe', () => {
    expect([...SanitizeConfig.FORBID_TAGS]).toContain('script');
    expect([...SanitizeConfig.FORBID_TAGS]).toContain('iframe');
  });

  it('is frozen so callers cannot silently widen the allowlist', () => {
    expect(Object.isFrozen(SanitizeConfig)).toBe(true);
  });
});
