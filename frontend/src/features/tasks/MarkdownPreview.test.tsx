import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { MarkdownPreview, stripHtmlFromMarkdown } from './MarkdownPreview';

function renderWith(markdown: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MarkdownPreview markdown={markdown} />
    </NextIntlClientProvider>,
  );
}

describe('stripHtmlFromMarkdown', () => {
  it('removes <script> while preserving surrounding text', () => {
    const out = stripHtmlFromMarkdown('hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('strips inline HTML tags but keeps text content', () => {
    const out = stripHtmlFromMarkdown('safe <img src=x onerror=alert(1)> content');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).toContain('content');
  });
});

describe('MarkdownPreview', () => {
  it('renders headings and emphasis from Markdown source', () => {
    const { container } = renderWith('# Title\n\n_italic_ **bold**');
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('does not render a <script> tag from the source', () => {
    const { container } = renderWith('paragraph <script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('drops a javascript: href', () => {
    const { container } = renderWith('[click](javascript:alert(1))');
    const link = container.querySelector('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href).not.toContain('javascript:');
  });

  it('keeps external https links but forces rel + target', () => {
    const { container } = renderWith('[docs](https://tasker.dev)');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://tasker.dev');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('renders GFM task-list checkboxes', () => {
    const { container } = renderWith('- [ ] pending\n- [x] done');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
  });
});
