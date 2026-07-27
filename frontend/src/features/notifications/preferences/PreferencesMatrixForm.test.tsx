import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enMessages from '@/i18n/messages/en.json';

vi.mock('@/lib/http/notifications', () => ({
  notificationsHttp: {
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { notificationsHttp } from '@/lib/http/notifications';
import { toast } from 'sonner';
import { PreferencesMatrixForm } from './PreferencesMatrixForm';

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

describe('PreferencesMatrixForm', () => {
  it('hydrates checkboxes from the loaded preferences', async () => {
    vi.mocked(notificationsHttp.getPreferences).mockResolvedValue({
      items: [
        { eventType: 'COMMENT_MENTION', channel: 'IN_APP', enabled: true },
        { eventType: 'COMMENT_MENTION', channel: 'EMAIL', enabled: false },
        { eventType: 'COMMENT_MENTION', channel: 'PUSH', enabled: true },
        { eventType: 'TASK_ASSIGNED', channel: 'IN_APP', enabled: true },
        { eventType: 'TASK_ASSIGNED', channel: 'EMAIL', enabled: true },
        { eventType: 'TASK_ASSIGNED', channel: 'PUSH', enabled: true },
        { eventType: 'COMMENT_FOLLOWED', channel: 'IN_APP', enabled: true },
        { eventType: 'COMMENT_FOLLOWED', channel: 'EMAIL', enabled: false },
        { eventType: 'COMMENT_FOLLOWED', channel: 'PUSH', enabled: false },
        { eventType: 'SPRINT_LIFECYCLE', channel: 'IN_APP', enabled: true },
        { eventType: 'SPRINT_LIFECYCLE', channel: 'EMAIL', enabled: true },
        { eventType: 'SPRINT_LIFECYCLE', channel: 'PUSH', enabled: false },
      ],
    });
    renderWith(<PreferencesMatrixForm />);
    await waitFor(() => {
      const mentionEmail = screen.getByLabelText(/mentioned you in a comment — Email/i);
      expect((mentionEmail as HTMLInputElement).checked).toBe(false);
    });
    const mentionInApp = screen.getByLabelText(/mentioned you in a comment — In app/i);
    expect((mentionInApp as HTMLInputElement).checked).toBe(true);
  });

  it('submits the full flattened matrix on save', async () => {
    vi.mocked(notificationsHttp.getPreferences).mockResolvedValue({
      items: [{ eventType: 'COMMENT_MENTION', channel: 'IN_APP', enabled: true }],
    });
    vi.mocked(notificationsHttp.updatePreferences).mockResolvedValue(undefined);
    renderWith(<PreferencesMatrixForm />);

    await waitFor(() => screen.getByRole('button', { name: /Save preferences/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save preferences/ }));

    await waitFor(() => expect(notificationsHttp.updatePreferences).toHaveBeenCalledTimes(1));
    const call = vi.mocked(notificationsHttp.updatePreferences).mock.calls[0]![0];
    expect(call.preferences).toHaveLength(12);
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces an error toast when the update fails', async () => {
    vi.mocked(notificationsHttp.getPreferences).mockResolvedValue({ items: [] });
    vi.mocked(notificationsHttp.updatePreferences).mockRejectedValueOnce(new Error('boom'));
    renderWith(<PreferencesMatrixForm />);

    await waitFor(() => screen.getByRole('button', { name: /Save preferences/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save preferences/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
