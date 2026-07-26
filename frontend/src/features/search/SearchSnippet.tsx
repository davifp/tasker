'use client';

import DOMPurify from 'isomorphic-dompurify';
import { useMemo } from 'react';

interface SearchSnippetProps {
  html: string;
  className?: string;
}

// Restrictive allowlist: only <mark> and <b> survive, no attributes.
// ts_headline emits `<mark>` around matched terms; we keep <b> for future-proofing.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['mark', 'b'],
  ALLOWED_ATTR: [] as string[],
  KEEP_CONTENT: true,
};

/**
 * Renders a ts_headline snippet safely. DOMPurify strips everything except
 * `<mark>` and `<b>`; attributes and event handlers are dropped entirely.
 * Empty snippets render as null so the layout collapses cleanly.
 */
export function SearchSnippet({ html, className }: SearchSnippetProps) {
  const clean = useMemo(() => DOMPurify.sanitize(html ?? '', SANITIZE_CONFIG), [html]);
  if (!clean) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
