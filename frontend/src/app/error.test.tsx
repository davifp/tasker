import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Sentry from '@sentry/nextjs';
import RouteError from './error';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

describe('app/error.tsx', () => {
  it('captures the thrown error on mount and echoes the digest', () => {
    const err = Object.assign(new Error('boom'), { digest: 'digest-123' });
    render(<RouteError error={err} reset={() => undefined} />);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    expect(screen.getByText('digest-123')).toBeInTheDocument();
  });

  it('invokes reset() when the Try again button is clicked', async () => {
    const reset = vi.fn();
    render(<RouteError error={new Error('boom')} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('omits the digest badge when the error has no digest field', () => {
    render(<RouteError error={new Error('boom')} reset={() => undefined} />);
    expect(screen.queryByText(/^digest-/)).toBeNull();
  });
});
