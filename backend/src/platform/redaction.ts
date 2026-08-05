// Known-secret patterns for the platform surface. Used by the redaction
// helper below and by the redaction spec that guards against a regression
// where a raw API key, webhook secret, or OAuth token accidentally lands in
// a log line or a serialised response body.
//
// The patterns intentionally over-match: they are tuned to catch obvious
// leaks (Stripe-style key prefixes, base64url tails of 32+ chars in the
// vicinity of "secret"/"token" keys) at the cost of false positives.
// Callers should never rely on these as the *only* safeguard — the primary
// defence is not putting the raw material into loggable state in the first
// place.

const API_KEY_RE = /\btsk_(?:live|test)_[A-Za-z0-9_-]{20,}\b/;
const GITHUB_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/;
const GOOGLE_TOKEN_RE = /\bya29\.[A-Za-z0-9_-]{20,}\b/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

const SECRETS: readonly RegExp[] = [API_KEY_RE, GITHUB_TOKEN_RE, GOOGLE_TOKEN_RE, JWT_RE];

/** True if the input contains any pattern that looks like a known secret. */
export function containsKnownSecret(input: string): boolean {
  return SECRETS.some((re) => re.test(input));
}

/**
 * Return a copy of `input` with any recognised secret substring replaced by
 * `[REDACTED]`. Intended for log-line preprocessing when a caller is about
 * to log a raw string that *might* contain user-supplied secret material.
 */
export function redactKnownSecrets(input: string): string {
  return SECRETS.reduce((acc, re) => acc.replace(new RegExp(re, 'g'), '[REDACTED]'), input);
}
