/**
 * DOMPurify allowlist shared by the server-side render path and the client-side
 * <SafeMarkdown> component. Keeping one source of truth prevents the two paths
 * from drifting into "sanitized here, not sanitized there" bugs.
 *
 * Rationale for each entry:
 * - Block-level Markdown output: headings, paragraphs, lists, blockquote,
 *   horizontal rules, tables (remark-gfm), code blocks.
 * - Inline formatting: strong/em/code/del.
 * - Anchors: allowed, but rendered with a hook that forces target=_blank and
 *   rel="noopener noreferrer" (see SafeMarkdown for the enforcement point).
 * - Images: allowed so previews of attachment URLs render inline; src is
 *   restricted to http(s) via ALLOWED_URI_REGEXP.
 * - Scripts, iframes, event handlers, and javascript: URLs are stripped —
 *   these are the primary XSS vectors and never appear in valid Markdown.
 */

export const SANITIZE_ALLOWED_TAGS: readonly string[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'del',
  'span',
  'img',
];

export const SANITIZE_ALLOWED_ATTR: readonly string[] = [
  'href',
  'title',
  'alt',
  'src',
  'class',
  'target',
  'rel',
];

/**
 * URIs accepted on <a href> and <img src>. Matches http(s), mailto, and
 * relative paths (no scheme). Everything else — including javascript:, data:,
 * vbscript: — is dropped by DOMPurify before rendering.
 */
export const SANITIZE_ALLOWED_URI_REGEXP: RegExp =
  /^(?:https?:|mailto:|[^a-z]|[a-z+.-]+(?![a-z+.:\-\d]))/i;

export const SanitizeConfig = Object.freeze({
  ALLOWED_TAGS: SANITIZE_ALLOWED_TAGS,
  ALLOWED_ATTR: SANITIZE_ALLOWED_ATTR,
  ALLOWED_URI_REGEXP: SANITIZE_ALLOWED_URI_REGEXP,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'] as const,
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'style'] as const,
});
