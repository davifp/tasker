import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { NotificationList } from './NotificationList';
import type { NotificationItem } from '@/lib/http/notifications';

function renderWith(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function make(id: string, overrides?: Partial<NotificationItem>): NotificationItem {
  return {
    id,
    workspaceId: 'ws-1',
    recipientUserId: 'user-a',
    actorUserId: 'actor-1',
    eventType: 'COMMENT_MENTION',
    sourceKind: 'COMMENT',
    sourceId: 'c-1',
    payload: { actorDisplayName: 'Ana Silva' },
    readAt: null,
    createdAt: '2026-07-27T12:00:00Z',
    ...overrides,
  };
}

describe('NotificationList', () => {
  it('renders the empty state when there are no items', () => {
    renderWith(<NotificationList items={[]} />);
    expect(screen.getByText(enMessages.notifications.bell.empty)).toBeInTheDocument();
  });

  it('renders items and dispatches onMarkRead when an item is clicked (with href)', () => {
    const onMarkRead = vi.fn();
    renderWith(
      <NotificationList
        items={[make('n-1')]}
        onMarkRead={onMarkRead}
        hrefFor={() => '/acme/projects/foo/tasks/1'}
      />,
    );
    const link = screen.getByRole('link', { name: /mentioned you/ });
    fireEvent.click(link);
    expect(onMarkRead).toHaveBeenCalledWith('n-1');
  });

  it('shows a Load more button when hasNextPage is true', () => {
    const onLoadMore = vi.fn();
    renderWith(<NotificationList items={[make('n-1')]} hasNextPage onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: /Load more/ }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('renders the error surface with a retry action', () => {
    const onRetry = vi.fn();
    renderWith(<NotificationList items={[]} isError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});
