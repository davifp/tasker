import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enMessages from '@/i18n/messages/en.json';
import type { Activity } from '@/lib/http/types';

vi.mock('@/lib/http/activity', () => ({
  activityHttp: {
    forTask: vi.fn(),
  },
}));

vi.mock('@/features/tasks/AssigneeBubble', () => ({
  AssigneeBubble: () => null,
}));

import { activityHttp } from '@/lib/http/activity';
import { ActivityFeed } from './ActivityFeed';

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

describe('ActivityFeed', () => {
  it('renders comment.created and attachment.uploaded verbs from payload', async () => {
    const activities: Activity[] = [
      {
        id: 'a1',
        workspaceId: 'w',
        projectId: 'p',
        taskId: 't',
        actorUserId: 'u-1',
        verb: 'comment.created',
        payload: { actorDisplayName: 'Ana Silva' },
        createdAt: '2026-07-25T00:00:00Z',
      },
      {
        id: 'a2',
        workspaceId: 'w',
        projectId: 'p',
        taskId: 't',
        actorUserId: 'u-1',
        verb: 'attachment.uploaded',
        payload: { actorDisplayName: 'Ana Silva', attachmentFilename: 'notes.pdf' },
        createdAt: '2026-07-24T00:00:00Z',
      },
    ];
    vi.mocked(activityHttp.forTask).mockResolvedValueOnce({ items: activities, nextCursor: null });

    const { container } = renderWith(
      <ActivityFeed workspaceSlug="ws" projectSlug="p" taskNumber={42} />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('commented');
    });
    expect(container.textContent).toContain('Ana Silva');
    expect(container.textContent).toContain('attached notes.pdf');
  });

  it('renders task.status_changed with from/to interpolation', async () => {
    vi.mocked(activityHttp.forTask).mockResolvedValueOnce({
      items: [
        {
          id: 'a1',
          workspaceId: 'w',
          projectId: 'p',
          taskId: 't',
          actorUserId: 'u-1',
          verb: 'task.status_changed',
          payload: { actorDisplayName: 'Ana Silva', from: 'TODO', to: 'IN_PROGRESS' },
          createdAt: '2026-07-25T00:00:00Z',
        },
      ],
      nextCursor: null,
    });

    const { container } = renderWith(
      <ActivityFeed workspaceSlug="ws" projectSlug="p" taskNumber={42} />,
    );

    await waitFor(() => expect(container.textContent).toContain('TODO'));
    expect(container.textContent).toContain('IN_PROGRESS');
  });
});
