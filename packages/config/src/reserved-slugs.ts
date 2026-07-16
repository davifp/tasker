// Slugs that are forbidden for workspace URLs. Reserved because they either
// clash with existing or future URL paths (admin, api, auth, login, me), CDN
// subdomains (www, cdn, static), or are commonly abused for phishing.
// New entries should be lowercase.
export const RESERVED_SLUGS = new Set<string>([
  'admin',
  'api',
  'app',
  'apps',
  'auth',
  'billing',
  'cdn',
  'checkout',
  'dashboard',
  'docs',
  'help',
  'invitations',
  'login',
  'logout',
  'me',
  'oauth',
  'pricing',
  'privacy',
  'register',
  'settings',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'test',
  'tests',
  'www',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
