import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { REACTIONS_CATALOG } from '@tasker/config';
import { ReactionBar } from './ReactionBar';
import type { ReactionSummary } from '@/lib/http/types';

function renderWith(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('ReactionBar', () => {
  it('renders one button for every emoji in the catalog', () => {
    const { container } = renderWith(<ReactionBar summaries={[]} onToggle={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(REACTIONS_CATALOG.length);
  });

  it('shows the count next to an emoji when reactions exist', () => {
    const summary: ReactionSummary = {
      emoji: 'heart',
      count: 3,
      reactorSample: [
        { userId: 'u-1', displayName: 'Ana' },
        { userId: 'u-2', displayName: 'Bob' },
      ],
      reactedByMe: true,
    };
    const { container } = renderWith(<ReactionBar summaries={[summary]} onToggle={vi.fn()} />);
    const heartBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Heart'),
    );
    expect(heartBtn?.textContent).toContain('3');
    expect(heartBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('invokes onToggle with the emoji slug when a button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = renderWith(<ReactionBar summaries={[]} onToggle={onToggle} />);
    const rocketBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Rocket'),
    );
    fireEvent.click(rocketBtn!);
    expect(onToggle).toHaveBeenCalledWith('rocket');
  });

  it('reflects reactedByMe via aria-pressed', () => {
    const { container } = renderWith(
      <ReactionBar
        summaries={[
          {
            emoji: 'tada',
            count: 1,
            reactorSample: [{ userId: 'u-1', displayName: 'Ana' }],
            reactedByMe: false,
          },
        ]}
        onToggle={vi.fn()}
      />,
    );
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Celebrate'),
    );
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
  });
});
