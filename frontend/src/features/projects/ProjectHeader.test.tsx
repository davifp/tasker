import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test-utils/render-with-intl';
import { ProjectHeader } from './ProjectHeader';
import type { Project } from '@/lib/http/types';

let pathname = '/ws/projects/web/board';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(''),
}));

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

describe('ProjectHeader', () => {
  it('renders all four tabs with the correct localized labels', () => {
    pathname = '/ws/projects/web/board';
    renderWithIntl(<ProjectHeader workspaceSlug="ws" project={makeProject()} />);
    for (const label of ['Board', 'List', 'Backlog', 'Timeline']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active tab from the pathname', () => {
    pathname = '/ws/projects/web/backlog';
    renderWithIntl(<ProjectHeader workspaceSlug="ws" project={makeProject()} />);
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveTextContent('Backlog');
  });

  it('moves focus with the arrow keys per the WAI-ARIA tablist pattern', () => {
    pathname = '/ws/projects/web/board';
    renderWithIntl(<ProjectHeader workspaceSlug="ws" project={makeProject()} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]?.focus();
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!.parentElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1]!.parentElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('shows the project name and description', () => {
    pathname = '/ws/projects/web/board';
    renderWithIntl(
      <ProjectHeader workspaceSlug="ws" project={makeProject({ name: 'Website Relaunch' })} />,
    );
    expect(screen.getByRole('heading', { name: 'Website Relaunch' })).toBeInTheDocument();
    expect(screen.getByText('The website')).toBeInTheDocument();
  });
});
