import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import { renderWithIntl } from '@/test-utils/render-with-intl';

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh }),
  useSearchParams: () => searchParams,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('LoginForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn());
    push.mockClear();
    replace.mockClear();
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows an inline error when email is empty', async () => {
    const user = userEvent.setup();
    renderWithIntl(<LoginForm />);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
  });

  it('marks the email field as aria-invalid when invalid', async () => {
    const user = userEvent.setup();
    renderWithIntl(<LoginForm />);
    await user.type(screen.getByLabelText(/^email$/i), 'not-an-email');
    await user.type(screen.getByLabelText(/^password$/i), 'secret1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
  });

  it('replaces to redirectTo on successful submit', async () => {
    searchParams = new URLSearchParams({ redirectTo: '/acme/projects' });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ userId: 'u-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const user = userEvent.setup();
    renderWithIntl(<LoginForm />);
    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/acme/projects'));
  });

  it('refuses external redirectTo values (defense against open redirect)', async () => {
    searchParams = new URLSearchParams({ redirectTo: '//evil.example.com/steal' });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ userId: 'u-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const user = userEvent.setup();
    renderWithIntl(<LoginForm />);
    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
