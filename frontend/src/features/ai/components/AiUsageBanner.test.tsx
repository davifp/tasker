import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiUsageBanner } from './AiUsageBanner';
import type { AiUsageSnapshot } from '@/lib/http/ai';

function usage(overrides: Partial<AiUsageSnapshot> = {}): AiUsageSnapshot {
  return {
    workspaceId: 'w-1',
    billingMonth: '2026-08',
    tokensBudget: 1000,
    tokensReserved: 0,
    tokensConsumed: 0,
    consent: { accepted: true, requiredDocumentVersion: 'v1' },
    ...overrides,
  };
}

describe('AiUsageBanner', () => {
  it('renders nothing when consent is accepted and budget is well under 80%', () => {
    const { container } = render(<AiUsageBanner usage={usage()} isAdmin />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when usage is undefined (loading)', () => {
    const { container } = render(<AiUsageBanner usage={undefined} isAdmin />);
    expect(container.firstChild).toBeNull();
  });

  it('surfaces the admin consent CTA when consent is missing and viewer is admin', async () => {
    const accept = vi.fn();
    render(
      <AiUsageBanner
        usage={usage({ consent: { accepted: false, requiredDocumentVersion: 'v1' } })}
        isAdmin
        onAcceptConsent={accept}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /accept and enable/i }));
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('tells non-admin members that an admin must enable AI', () => {
    render(
      <AiUsageBanner
        usage={usage({ consent: { accepted: false, requiredDocumentVersion: 'v1' } })}
        isAdmin={false}
      />,
    );
    expect(screen.getByText(/Admin must enable AI/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept and enable/i })).not.toBeInTheDocument();
  });

  it('renders the red "limit reached" alert when budget is exhausted', () => {
    render(<AiUsageBanner usage={usage({ tokensConsumed: 1000 })} isAdmin />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Monthly limit reached/i);
  });

  it('renders the yellow "approaching limit" warning at ≥ 80%', () => {
    render(<AiUsageBanner usage={usage({ tokensConsumed: 850 })} isAdmin />);
    expect(screen.getByText(/Approaching monthly limit/i)).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });
});
