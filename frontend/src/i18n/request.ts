import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultTimeZone, localeCookieName, resolveLocale } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(localeCookieName)?.value);
  const messages = (await import(`./messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    // Pin a deterministic default so SSR and CSR agree on datetime formatting
    // even when the server host TZ differs from the browser. Components that
    // need workspace-local rendering must pass an explicit `timeZone` to the
    // formatter — this is only the app-wide fallback.
    timeZone: defaultTimeZone,
  };
});
