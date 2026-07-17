import { describe, it, expect } from 'vitest';
import { defaultLocale, isLocale, resolveLocale } from './config';

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
});
