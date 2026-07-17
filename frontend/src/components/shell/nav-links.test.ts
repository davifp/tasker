import { describe, it, expect } from 'vitest';
import { equivalentPathInWorkspace, primaryNavLinks } from './nav-links';

describe('primaryNavLinks', () => {
  it('exposes projects, sprints, roadmap, dashboard', () => {
    expect(primaryNavLinks.map((link) => link.key)).toEqual([
      'projects',
      'sprints',
      'roadmap',
      'dashboard',
    ]);
  });

  it('matches nested paths under a section', () => {
    const projects = primaryNavLinks[0];
    if (!projects) throw new Error('projects link missing');
    expect(projects.match('/acme/projects/board-1', 'acme')).toBe(true);
    expect(projects.match('/acme/sprints', 'acme')).toBe(false);
  });
});

describe('equivalentPathInWorkspace', () => {
  it('rewrites the workspace slug in the current path', () => {
    expect(equivalentPathInWorkspace('/acme/projects/board-1', 'acme', 'beta')).toBe(
      '/beta/projects/board-1',
    );
  });

  it('rewrites the workspace root path', () => {
    expect(equivalentPathInWorkspace('/acme', 'acme', 'beta')).toBe('/beta');
  });

  it('falls back to /:slug/projects when the current path is outside the workspace', () => {
    expect(equivalentPathInWorkspace('/settings', 'acme', 'beta')).toBe('/beta/projects');
  });
});
