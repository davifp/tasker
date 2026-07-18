import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import type { CursorPage, Project } from '@/lib/http/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ws/projects',
}));

vi.mock('@/lib/http/projects', () => ({
  projectsHttp: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

import { projectsHttp } from '@/lib/http/projects';
import { ProjectListPage } from './ProjectListPage';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    workspaceId: 'ws-1',
    slug: 'web',
    name: 'Web',
    description: 'The website',
    color: '#3b82f6',
    icon: 'Package',
    status: 'ACTIVE',
    ownerUserId: 'u-1',
    createdByUserId: 'u-1',
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = makeQueryClient();
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <ProjectListPage workspaceSlug="ws" />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectListPage', () => {
  it('renders the skeleton then the empty state when no projects exist', async () => {
    vi.mocked(projectsHttp.list).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    } satisfies CursorPage<Project>);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('project-empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });

  it('renders a grid of ProjectCards when projects come back', async () => {
    vi.mocked(projectsHttp.list).mockResolvedValueOnce({
      items: [
        makeProject({ id: 'p-1', slug: 'web', name: 'Web' }),
        makeProject({ id: 'p-2', slug: 'api', name: 'API' }),
      ],
      nextCursor: null,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('project-grid')).toBeInTheDocument();
    });
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
  });

  it('opens the create dialog when the empty-state CTA is clicked', async () => {
    vi.mocked(projectsHttp.list).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('project-empty-state')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Create your first project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });

  it('surfaces a localized error banner when the list fetch fails', async () => {
    vi.mocked(projectsHttp.list).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't load projects/i);
    });
  });
});
