import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiOutputBadge } from './AiOutputBadge';

describe('AiOutputBadge', () => {
  it('renders a label + icon so color is not the only signal', () => {
    render(<AiOutputBadge />);
    // aria-label carries the same text as the visible label so screen
    // readers and sighted users see the same signal.
    expect(screen.getByRole('note', { name: /ai-generated/i })).toBeInTheDocument();
    expect(screen.getByText(/ai-generated/i)).toBeInTheDocument();
  });

  it('respects a custom label', () => {
    render(<AiOutputBadge label="AI draft" />);
    expect(screen.getByText('AI draft')).toBeInTheDocument();
  });
});
