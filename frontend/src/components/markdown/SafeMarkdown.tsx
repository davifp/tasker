'use client';

import { useMemo } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { type Options as RehypeSanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { MENTION_HANDLE_REGEXP, SanitizeConfig } from '@tasker/config';
import { cn } from '@/lib/utils';

interface SafeMarkdownProps {
  source: string;
  className?: string;
  /**
   * Optional map from handle (slug) → userId so a resolved mention renders as
   * a clickable pill. Unresolved handles render as plain text `@handle` so a
   * typo does not disappear from the comment body.
   */
  mentionMap?: Readonly<Record<string, { userId: string; displayName?: string }>>;
  onMentionClick?: (mention: { handle: string; userId: string }) => void;
}

/**
 * Renders untrusted Markdown safely.
 *
 * Defence in depth:
 *   1. `DOMPurify.sanitize(..., { ALLOWED_TAGS: [] })` strips every HTML tag
 *      from the raw source before remark sees it. If a user pastes
 *      `<script>alert(1)</script>`, remark receives `alert(1)` as plain text.
 *   2. `rehype-sanitize` re-enforces the same allowlist at the HAST layer, so
 *      any HTML that remark synthesises stays inside the SanitizeConfig
 *      allowlist from `@tasker/config` (shared with the backend to prevent
 *      "sanitized here, not there" drift).
 *   3. `urlTransform` drops `javascript:` and other non-http(s)/mailto URIs
 *      before the anchor override runs.
 *   4. External `<a>` gets `rel="noopener noreferrer" target="_blank"`.
 *
 * Mentions: after parse, text nodes are scanned with MENTION_HANDLE_REGEXP
 * (shared with the backend's MentionParser). Resolved handles render as a
 * pill; unresolved ones fall back to inline `@handle` text so a typo remains
 * visible instead of vanishing.
 */
export function SafeMarkdown({ source, className, mentionMap, onMentionClick }: SafeMarkdownProps) {
  const safe = useMemo(() => stripHtmlFromMarkdown(source.trim()), [source]);
  if (!safe) return null;
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        urlTransform={(url) => (SanitizeConfig.ALLOWED_URI_REGEXP.test(url) ? url : '')}
        components={buildComponents({ mentionMap, onMentionClick })}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------

const purifyStripHtmlConfig = {
  ALLOWED_TAGS: [] as string[],
  ALLOWED_ATTR: [] as string[],
  KEEP_CONTENT: true,
} as const;

export function stripHtmlFromMarkdown(markdown: string): string {
  return DOMPurify.sanitize(markdown, {
    ...purifyStripHtmlConfig,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as string;
}

const sanitizeSchema: RehypeSanitizeOptions = {
  tagNames: [...SanitizeConfig.ALLOWED_TAGS],
  attributes: {
    '*': [...SanitizeConfig.ALLOWED_ATTR],
  },
  clobberPrefix: 'safe-md-',
};

function buildComponents(opts: {
  mentionMap?: SafeMarkdownProps['mentionMap'];
  onMentionClick?: SafeMarkdownProps['onMentionClick'];
}): Components {
  return {
    a({ href, children, ...rest }) {
      const safeHref = href && /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
      const external = safeHref?.startsWith('http');
      return (
        <a
          href={safeHref}
          rel={external ? 'noopener noreferrer' : undefined}
          target={external ? '_blank' : undefined}
          {...rest}
        >
          {children}
        </a>
      );
    },
    p({ children, ...rest }) {
      return <p {...rest}>{renderChildrenWithMentions(children, opts)}</p>;
    },
    li({ children, ...rest }) {
      return <li {...rest}>{renderChildrenWithMentions(children, opts)}</li>;
    },
  };
}

function renderChildrenWithMentions(
  children: React.ReactNode,
  opts: {
    mentionMap?: SafeMarkdownProps['mentionMap'];
    onMentionClick?: SafeMarkdownProps['onMentionClick'];
  },
): React.ReactNode {
  return renderChildren(children, (text, keyPrefix) =>
    splitTextWithMentions(text, keyPrefix, opts),
  );
}

function renderChildren(
  children: React.ReactNode,
  textRenderer: (text: string, key: string) => React.ReactNode,
): React.ReactNode {
  if (typeof children === 'string') return textRenderer(children, 's');
  if (!Array.isArray(children)) return children;
  return children.map((child, idx) => {
    if (typeof child === 'string') return textRenderer(child, `s-${idx}`);
    return child;
  });
}

function splitTextWithMentions(
  text: string,
  keyPrefix: string,
  opts: {
    mentionMap?: SafeMarkdownProps['mentionMap'];
    onMentionClick?: SafeMarkdownProps['onMentionClick'];
  },
): React.ReactNode {
  if (!opts.mentionMap || Object.keys(opts.mentionMap).length === 0) return text;
  const regex = new RegExp(MENTION_HANDLE_REGEXP.source, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    const handle = match[1]!;
    const resolved = opts.mentionMap[handle];
    // Preserve the pre-match anchor char (space/paren/etc) that the regex
    // consumes in group 0 but not in group 1.
    const anchor = match[0]!.startsWith('@') ? '' : match[0]!.charAt(0);
    const mentionStart = match.index + anchor.length;
    if (mentionStart > lastIndex) {
      nodes.push(text.slice(lastIndex, mentionStart));
    }
    if (resolved) {
      nodes.push(
        <button
          key={`${keyPrefix}-m-${idx++}`}
          type="button"
          className="inline-flex items-center rounded-md bg-primary/10 px-1 text-xs font-medium text-primary hover:bg-primary/20"
          onClick={() => opts.onMentionClick?.({ handle, userId: resolved.userId })}
        >
          @{resolved.displayName ?? handle}
        </button>,
      );
    } else {
      nodes.push(`@${handle}`);
    }
    lastIndex = mentionStart + 1 + handle.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
