import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserProjectViewPreferencesService,
  shallowMergeViewPreferences,
} from './user-project-view-preferences.service';
import type { ViewPreferences } from './dto/view-preferences.dto';

const USER = 'user-1';
const PROJECT = 'proj-1';

// Mutable mock — the service touches only `userProjectViewPreference`.
const prefsClient = {
  findUnique: vi.fn(),
  upsert: vi.fn(),
};

const rawClient = { userProjectViewPreference: prefsClient };
const mockPrisma = { forSystem: vi.fn(() => rawClient) };

async function buildService(): Promise<UserProjectViewPreferencesService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      UserProjectViewPreferencesService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  return moduleRef.get(UserProjectViewPreferencesService);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// shallowMergeViewPreferences — pure helper, exercised in isolation
// -----------------------------------------------------------------------------

describe('shallowMergeViewPreferences', () => {
  it('returns a fresh object with disjoint keys unioned', () => {
    const existing: ViewPreferences = { defaultView: 'board' };
    const patch: ViewPreferences = { timeline: { windowWeeks: 2 } };
    expect(shallowMergeViewPreferences(existing, patch)).toEqual({
      defaultView: 'board',
      timeline: { windowWeeks: 2 },
    });
  });

  it('patch wins on overlapping top-level keys', () => {
    const existing: ViewPreferences = { defaultView: 'board' };
    const patch: ViewPreferences = { defaultView: 'list' };
    expect(shallowMergeViewPreferences(existing, patch)).toEqual({ defaultView: 'list' });
  });

  it('replaces nested objects wholesale (shallow — not deep-merge)', () => {
    const existing: ViewPreferences = {
      list: {
        columns: ['a', 'b', 'c'],
        hidden: ['d'],
        sort: { by: 'title', dir: 'asc' },
      },
    };
    // Only sending `sort` in the new `list` — the shallow merge REPLACES the
    // whole `list` sub-object; `columns` and `hidden` disappear.
    const patch: ViewPreferences = {
      list: {
        columns: ['x'],
        hidden: [],
        sort: { by: 'dueDate', dir: 'desc' },
      },
    };
    const merged = shallowMergeViewPreferences(existing, patch);
    expect(merged.list).toEqual({
      columns: ['x'],
      hidden: [],
      sort: { by: 'dueDate', dir: 'desc' },
    });
  });

  it('empty patch is the identity operation', () => {
    const existing: ViewPreferences = { defaultView: 'timeline' };
    expect(shallowMergeViewPreferences(existing, {})).toEqual(existing);
  });

  it('empty existing collapses to the patch', () => {
    const patch: ViewPreferences = { defaultView: 'calendar' };
    expect(shallowMergeViewPreferences({}, patch)).toEqual(patch);
  });

  it('does not mutate the inputs', () => {
    const existing: ViewPreferences = { defaultView: 'board' };
    const patch: ViewPreferences = { defaultView: 'list' };
    shallowMergeViewPreferences(existing, patch);
    expect(existing).toEqual({ defaultView: 'board' });
    expect(patch).toEqual({ defaultView: 'list' });
  });
});

// -----------------------------------------------------------------------------
// getFor
// -----------------------------------------------------------------------------

describe('UserProjectViewPreferencesService.getFor', () => {
  it('returns `{}` when no row exists (never 404)', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce(null);

    const result = await service.getFor(USER, PROJECT);
    expect(result).toEqual({});
    expect(prefsClient.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: USER, projectId: PROJECT } },
    });
  });

  it('returns the parsed stored prefs when a row exists', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      prefs: { defaultView: 'timeline' },
      updatedAt: new Date(),
    });

    expect(await service.getFor(USER, PROJECT)).toEqual({ defaultView: 'timeline' });
  });

  it('strips any unknown keys that slipped past the write path', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      // Simulates a hand-edited DB row or a legacy field. The read path
      // silently drops the unknown key.
      prefs: { defaultView: 'board', legacyKey: 'x' },
      updatedAt: new Date(),
    });

    expect(await service.getFor(USER, PROJECT)).toEqual({ defaultView: 'board' });
  });

  it('collapses malformed persisted JSON to `{}` instead of throwing', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      // `defaultView` value is not one of the enum members — the safeParse
      // fails, and the service falls back to `{}` rather than 500-ing the
      // caller.
      prefs: { defaultView: 'ancient-view' },
      updatedAt: new Date(),
    });

    expect(await service.getFor(USER, PROJECT)).toEqual({});
  });
});

// -----------------------------------------------------------------------------
// upsert — first-time create + merge over an existing row
// -----------------------------------------------------------------------------

describe('UserProjectViewPreferencesService.upsert', () => {
  it('creates a row with the patch when none exists', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce(null);
    prefsClient.upsert.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      prefs: { defaultView: 'list' },
      updatedAt: new Date(),
    });

    const result = await service.upsert(USER, PROJECT, { defaultView: 'list' });
    expect(result).toEqual({ defaultView: 'list' });
    expect(prefsClient.upsert).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: USER, projectId: PROJECT } },
      create: { userId: USER, projectId: PROJECT, prefs: { defaultView: 'list' } },
      update: { prefs: { defaultView: 'list' } },
    });
  });

  it('shallow-merges the patch into an existing row', async () => {
    const service = await buildService();
    // Existing row already carries `defaultView` — new patch adds `timeline`
    // without touching `defaultView`.
    prefsClient.findUnique.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      prefs: { defaultView: 'board' },
      updatedAt: new Date(),
    });
    prefsClient.upsert.mockResolvedValueOnce({});

    const result = await service.upsert(USER, PROJECT, { timeline: { windowWeeks: 4 } });
    expect(result).toEqual({
      defaultView: 'board',
      timeline: { windowWeeks: 4 },
    });
    // The persisted row is the merged payload, not just the patch.
    expect(prefsClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          userId: USER,
          projectId: PROJECT,
          prefs: { defaultView: 'board', timeline: { windowWeeks: 4 } },
        },
        update: {
          prefs: { defaultView: 'board', timeline: { windowWeeks: 4 } },
        },
      }),
    );
  });

  it('replaces whole sub-objects on merge (shallow, not deep)', async () => {
    const service = await buildService();
    prefsClient.findUnique.mockResolvedValueOnce({
      userId: USER,
      projectId: PROJECT,
      prefs: {
        list: {
          columns: ['a', 'b'],
          hidden: ['c'],
          sort: { by: 'title', dir: 'asc' },
        },
      },
      updatedAt: new Date(),
    });
    prefsClient.upsert.mockResolvedValueOnce({});

    const patch: ViewPreferences = {
      list: {
        columns: ['x'],
        hidden: [],
        sort: { by: 'dueDate', dir: 'desc' },
      },
    };
    const result = await service.upsert(USER, PROJECT, patch);
    expect(result.list).toEqual(patch.list);
  });
});
