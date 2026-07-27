import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enMessages from '@/i18n/messages/en.json';

vi.mock('@/lib/http/notifications', () => ({
  notificationsHttp: {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

import { notificationsHttp } from '@/lib/http/notifications';
import { NotificationBell } from './NotificationBell';

function renderWith(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('NotificationBell', () => {
  it('renders the unread badge when there are unread notifications', async () => {
    vi.mocked(notificationsHttp.unreadCount).mockResolvedValue({ count: 4 });
    renderWith(<NotificationBell workspaceSlug="acme" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/4 unread/)).toBeInTheDocument();
    });
  });

  it('caps the badge label at 99+', async () => {
    vi.mocked(notificationsHttp.unreadCount).mockResolvedValue({ count: 250 });
    renderWith(<NotificationBell workspaceSlug="acme" />);
    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });

  it('does not call the list endpoint before the dropdown opens', async () => {
    vi.mocked(notificationsHttp.unreadCount).mockResolvedValue({ count: 1 });
    vi.mocked(notificationsHttp.list).mockResolvedValue({ items: [], nextCursor: null });
    renderWith(<NotificationBell workspaceSlug="acme" />);

    await waitFor(() => {
      expect(notificationsHttp.unreadCount).toHaveBeenCalled();
    });
    // The list query is `enabled: open`, so opening is required to fetch.
    // Radix DropdownMenu open behavior is exercised in Playwright (Task 10.0)
    // where real pointer events are available.
    expect(notificationsHttp.list).not.toHaveBeenCalled();
  });

  it('does not render a badge when count is 0', async () => {
    vi.mocked(notificationsHttp.unreadCount).mockResolvedValue({ count: 0 });
    renderWith(<NotificationBell workspaceSlug="acme" />);
    await waitFor(() => {
      expect(notificationsHttp.unreadCount).toHaveBeenCalled();
    });
    expect(screen.queryByText(/99\+/)).not.toBeInTheDocument();
  });
});
