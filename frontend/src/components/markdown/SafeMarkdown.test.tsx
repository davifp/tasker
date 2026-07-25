import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { SafeMarkdown, stripHtmlFromMarkdown } from './SafeMarkdown';

function renderWith(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('stripHtmlFromMarkdown', () => {
  it('removes <script> and its payload', () => {
    const out = stripHtmlFromMarkdown('hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('strips inline HTML tags but preserves text content', () => {
    const out = stripHtmlFromMarkdown('safe <img src=x onerror=alert(1)> tail');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).toContain('tail');
  });
});

describe('SafeMarkdown — sanitization', () => {
  it('renders headings and inline formatting', () => {
    const { container } = renderWith(<SafeMarkdown source={'# Title\n\n_it_ **bold**'} />);
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('em')?.textContent).toBe('it');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('never renders a <script> tag even if the raw source contains one', () => {
    const { container } = renderWith(<SafeMarkdown source={'p <script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('drops a javascript: href on an anchor', () => {
    const { container } = renderWith(<SafeMarkdown source={'[click](javascript:alert(1))'} />);
    const link = container.querySelector('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href).not.toContain('javascript:');
  });

  it('forces rel="noopener noreferrer" target="_blank" on external https anchors', () => {
    const { container } = renderWith(<SafeMarkdown source={'[docs](https://tasker.dev)'} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://tasker.dev');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});

describe('SafeMarkdown — mentions', () => {
  it('renders a resolved @handle as a pill button', () => {
    const onMentionClick = vi.fn();
    const { container } = renderWith(
      <SafeMarkdown
        source={'hey @ana please review'}
        mentionMap={{ ana: { userId: 'u-1', displayName: 'Ana Silva' } }}
        onMentionClick={onMentionClick}
      />,
    );
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('@Ana Silva');
    fireEvent.click(button!);
    expect(onMentionClick).toHaveBeenCalledWith({ handle: 'ana', userId: 'u-1' });
  });

  it('leaves an unresolved handle as plain text so typos stay visible', () => {
    const { container } = renderWith(
      <SafeMarkdown source={'ping @nobody'} mentionMap={{ ana: { userId: 'u-1' } }} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('@nobody');
  });

  it('does not treat an @ inside a word as a mention', () => {
    const { container } = renderWith(
      <SafeMarkdown source={'email@example.com'} mentionMap={{ example: { userId: 'u-1' } }} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('email@example.com');
  });
});
