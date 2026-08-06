// Canonical names for the double-submit CSRF pair. The cookie is issued by
// the CsrfMiddleware and is NOT HttpOnly so the browser JS can read it; the
// header is echoed back on mutating verbs and validated by CsrfGuard.
export const CSRF_COOKIE_NAME = 'tsk_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
// 2-hour rotation window per the technical spec — long enough that active
// sessions never notice, short enough that a leaked token has a bounded
// window of use.
export const CSRF_COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const CSRF_TOKEN_LENGTH_BYTES = 32;

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
