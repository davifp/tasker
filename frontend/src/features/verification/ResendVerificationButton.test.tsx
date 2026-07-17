import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ResendVerificationButton } from './ResendVerificationButton';
import { renderWithIntl } from '@/test-utils/render-with-intl';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('ResendVerificationButton', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('disables the button after clicking', async () => {
    renderWithIntl(<ResendVerificationButton />);
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('shows a countdown label after the request settles', async () => {
    renderWithIntl(<ResendVerificationButton />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent ?? '').toMatch(/60/));
  });
});
