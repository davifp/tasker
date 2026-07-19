'use client';

import DOMPurify from 'isomorphic-dompurify';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
}

// Slightly widened schema over the rehype-sanitize default:
//   - allow the `input[type=checkbox]` tag GFM task-lists render as
//   - allow `className` on `<code>` for future syntax highlighting
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ['type', 'checkbox'],
      'checked',
      'disabled',
    ],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
};

const purifyStripHtmlConfig = {
  ALLOWED_TAGS: [] as string[],
  ALLOWED_ATTR: [] as string[],
  KEEP_CONTENT: true,
} as const;

// Belt-and-suspenders XSS defence:
//   1. `DOMPurify.sanitize` strips *every* HTML tag from the raw markdown
//      source before it reaches remark. Text content is preserved. If a
//      user pastes `<script>alert(1)</script>` we hand `alert(1)` — as
//      plain text — to the parser.
//   2. `rehype-sanitize` re-enforces the same policy at the HAST layer.
//   3. `urlTransform` strips `javascript:` URLs; the anchor override
//      keeps only http/https/mailto/tel/# hrefs and forces
//      rel="noreferrer noopener" target="_blank" on external links.
export function stripHtmlFromMarkdown(markdown: string): string {
  return DOMPurify.sanitize(markdown, {
    ...purifyStripHtmlConfig,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as string;
}

export function MarkdownPreview({ markdown, className }: MarkdownPreviewProps) {
  const safeSource = useMemo(() => stripHtmlFromMarkdown(markdown.trim()), [markdown]);
  if (!safeSource) {
    return null;
  }
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        urlTransform={(url) => {
          if (/^javascript:/i.test(url)) return '';
          return url;
        }}
        components={{
          a({ href, children, ...props }) {
            const safeHref =
              href && /^(https?:|mailto:|tel:|#)/i.test(href) ? href : undefined;
            const isExternal = safeHref?.startsWith('http');
            return (
              <a
                href={safeHref}
                rel={isExternal ? 'noreferrer noopener' : undefined}
                target={isExternal ? '_blank' : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {safeSource}
      </ReactMarkdown>
    </div>
  );
}
