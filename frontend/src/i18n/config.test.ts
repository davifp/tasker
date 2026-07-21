import { describe, it, expect } from 'vitest';
import { defaultLocale, defaultTimeZone, isLocale, resolveLocale } from './config';

describe('i18n config', () => {
  it('recognizes supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('pt-BR')).toBe(true);
  });

  it('rejects unsupported values', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('')).toBe(false);
  });

  it('resolves the cookie value to a supported locale, falling back to default', () => {
    expect(resolveLocale('pt-BR')).toBe('pt-BR');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale(undefined)).toBe(defaultLocale);
    expect(resolveLocale('xx')).toBe(defaultLocale);
  });

  // Regression for bugs.md BUG-03: next-intl warns on every SSR render when
  // the runtime config omits `timeZone`. The provider config in
  // `i18n/request.ts` reads `defaultTimeZone`, so this constant must exist
  // and resolve to a valid IANA identifier that Intl.DateTimeFormat accepts.
  it('exposes a valid IANA default timezone for the next-intl provider', () => {
    expect(defaultTimeZone).toBeDefined();
    expect(() => new Intl.DateTimeFormat('en', { timeZone: defaultTimeZone })).not.toThrow();
  });
});
