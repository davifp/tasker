import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoBanner } from './DemoBanner';

describe('DemoBanner', () => {
  it('announces itself politely for assistive tech', () => {
    render(<DemoBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('names the read-only nature and points at the signup path', () => {
    render(<DemoBanner />);
    expect(screen.getByText(/read-only demo/i)).toBeInTheDocument();
    expect(screen.getByText(/sign up/i)).toBeInTheDocument();
  });
});
