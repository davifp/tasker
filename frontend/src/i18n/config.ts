export const locales = ['en', 'pt-BR'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeCookieName = 'NEXT_LOCALE';

// App-wide fallback timezone for next-intl formatters. Kept at UTC to match
// the current Calendar `Workspace.timezone` fallback (see calendar/page.tsx).
// Once `Workspace.timezone` lands on the backend model, thread that value
// per-request instead of relying on this constant.
export const defaultTimeZone = 'UTC';

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}
