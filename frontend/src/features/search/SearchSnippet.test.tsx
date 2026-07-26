import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SearchSnippet } from './SearchSnippet';

describe('SearchSnippet', () => {
  it('renders <mark> tags emitted by ts_headline', () => {
    const { container } = render(<SearchSnippet html="fix <mark>login</mark> redirect loop" />);
    expect(container.innerHTML).toContain('<mark>login</mark>');
  });

  it('keeps <b> tags', () => {
    const { container } = render(<SearchSnippet html="<b>bold</b> text" />);
    expect(container.innerHTML).toContain('<b>bold</b>');
  });

  it('strips disallowed tags (script, img, iframe, a)', () => {
    const { container } = render(
      <SearchSnippet html="<script>alert(1)</script><img src=x onerror=alert(1)><iframe src='j'></iframe><a href='x'>link</a>hi" />,
    );
    const html = container.innerHTML;
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<a ');
    expect(html).toContain('hi');
  });

  it('strips event-handler attributes on allowed tags', () => {
    const { container } = render(<SearchSnippet html='<mark onclick="alert(1)">x</mark>' />);
    expect(container.innerHTML).toContain('<mark>x</mark>');
    expect(container.innerHTML).not.toContain('onclick');
  });

  it('renders null for empty snippets', () => {
    const { container } = render(<SearchSnippet html="" />);
    expect(container.innerHTML).toBe('');
  });
});
