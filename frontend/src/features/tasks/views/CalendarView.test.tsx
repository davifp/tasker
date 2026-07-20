import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import type { CursorPage, Task, TaskStatus } from '@/lib/http/types';
import {
  bucketKeyForIso,
  bucketKeyForDayDate,
  bucketTasksByDay,
} from './tz-bucketing';

// URL is the single source of truth for `useProjectFilters`; hook the
// router.replace assertion via the shared mock and mutate
// `mockSearchParams.current` to seed a filter state before mount.
const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => routerReplace(...args),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/ws/projects/p/calendar',
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
}));

vi.mock('@/features/members/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({ data: [] }),
}));

vi.mock('@/features/labels/hooks/useLabels', () => ({
  useLabels: () => ({ data: { items: [] } }),
}));

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    list: vi.fn(),
    findByNumber: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
  },
}));
vi.mock('@/lib/http/checklists', () => ({
  checklistsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/comments', () => ({
  commentsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/dependencies', () => ({
  dependenciesHttp: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { tasksHttp } from '@/lib/http/tasks';
import { CalendarView } from './CalendarView';

function taskFactory(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: 'ws',
    projectId: 'p',
    number: 1,
    title: 'Ship it',
    description: '',
    status: 'TODO' as TaskStatus,
    priority: 'MEDIUM',
    position: 'a1',
    assigneeUserId: null,
    createdByUserId: 'u',
    startDate: null,
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    labels: [],
    ...overrides,
  };
}

function renderCalendar(
  tasks: Task[],
  workspaceTimezone: string = 'UTC',
) {
  const queryClient = makeQueryClient();
  vi.mocked(tasksHttp.list).mockResolvedValue({
    items: tasks,
    nextCursor: null,
  } satisfies CursorPage<Task>);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider>
          <CalendarView
            workspaceSlug="ws"
            workspaceId="ws-1"
            projectSlug="p"
            projectId="p-1"
            currentUserId="u-1"
            currentUserRole="MEMBER"
            workspaceTimezone={workspaceTimezone}
          />
        </AnalyticsProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.current = '';
  // Fixed clock — the calendar defaults `month` to `new Date()` so the
  // rendered month depends on wall-clock time. Pinning it makes the
  // tests deterministic.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tz-bucketing helper', () => {
  it('buckets a task by workspace TZ, not browser TZ', () => {
    // 2026-07-15T02:00Z is 2026-07-14 23:00 in Sao Paulo (UTC-3),
    // so the bucket key must be the PREVIOUS day.
    expect(bucketKeyForIso('2026-07-15T02:00:00Z', 'America/Sao_Paulo')).toBe(
      '2026-07-14',
    );
    // Same instant in Tokyo (UTC+9) is 2026-07-15 11:00 local — still
    // the 15th.
    expect(bucketKeyForIso('2026-07-15T02:00:00Z', 'Asia/Tokyo')).toBe(
      '2026-07-15',
    );
  });

  it('bucketKeyForDayDate reads the day cell wall-clock, not TZ-shifted', () => {
    // A DayPicker cell for July 15 is Date(2026, 6, 15) at midnight
    // browser-local. We want the key to be 2026-07-15 regardless of
    // the machine's TZ.
    const d = new Date(2026, 6, 15);
    expect(bucketKeyForDayDate(d)).toBe('2026-07-15');
  });

  it('bucketTasksByDay excludes tasks with a null dueDate', () => {
    const tasks: Task[] = [
      taskFactory({ id: 't-a', dueDate: '2026-07-15T10:00:00Z' }),
      taskFactory({ id: 't-b', dueDate: null }),
    ];
    const buckets = bucketTasksByDay(tasks, 'UTC');
    expect(buckets.get('2026-07-15')?.length).toBe(1);
    // Only one bucket exists — the null-dueDate task did not create one.
    expect(buckets.size).toBe(1);
  });

  it('bucketing is invariant to browser TZ when workspace TZ is fixed', () => {
    // Cross-TZ display invariance: with the workspace TZ pinned, the
    // browser TZ must NOT influence the day a task lands on. We try
    // to swap the process TZ between calls via `vi.stubEnv('TZ', ...)`
    // — jsdom often ignores runtime TZ flips because Node's TZ is
    // captured at process start, so if the stubs are a no-op the
    // assertion collapses to "the pure helper is deterministic".
    // Either way, `bucketTasksByDay` never reads `Date.prototype`
    // methods that depend on the browser TZ (it feeds instants
    // through `formatInTimeZone(..., workspaceTimezone)`), so this
    // is the honest guarantee to document.
    const fixture: Task[] = [
      taskFactory({ id: 't-a', dueDate: '2026-07-15T22:00:00Z' }),
      taskFactory({ id: 't-b', dueDate: '2026-07-16T02:00:00Z' }),
    ];
    vi.stubEnv('TZ', 'UTC');
    const bucketsUtc = bucketTasksByDay(fixture, 'America/Sao_Paulo');
    vi.stubEnv('TZ', 'Asia/Tokyo');
    const bucketsTokyo = bucketTasksByDay(fixture, 'America/Sao_Paulo');
    // Compare the extracted { key → count } shape — `Map#toEqual` on
    // raw Maps with task references passes trivially by identity;
    // this normalizes to the property under test.
    const shape = (map: ReturnType<typeof bucketTasksByDay>) =>
      Array.from(map.entries())
        .map(([key, list]) => [key, list.length] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    expect(shape(bucketsUtc)).toEqual(shape(bucketsTokyo));
    // Workspace TZ = Sao Paulo (UTC-3): 2026-07-16T02:00Z is
    // 2026-07-15 23:00 local, so both tasks bucket into 2026-07-15.
    expect(bucketsUtc.get('2026-07-15')?.length).toBe(2);
    vi.unstubAllEnvs();
  });

  it('bucketKeyForIso falls back to UTC when workspaceTimezone is not a valid IANA ID', () => {
    // Guard against `date-fns-tz` throwing `Invalid time value` on
    // legacy/bad IDs sourced from a future `Workspace.timezone`.
    // 2026-07-15T02:00:00Z is 2026-07-15 in UTC.
    expect(bucketKeyForIso('2026-07-15T02:00:00Z', 'Not/AValidTz')).toBe(
      '2026-07-15',
    );
  });
});

describe('CalendarView — rendering', () => {
  it('renders the calendar grid with per-day badges for dated tasks', async () => {
    renderCalendar([
      taskFactory({
        id: 't-a',
        number: 1,
        title: 'Ship it',
        dueDate: '2026-07-15T10:00:00Z',
      }),
      taskFactory({
        id: 't-b',
        number: 2,
        title: 'Land it',
        dueDate: '2026-07-15T14:00:00Z',
      }),
      taskFactory({
        id: 't-c',
        number: 3,
        title: 'Talk about it',
        dueDate: '2026-07-20T09:00:00Z',
      }),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });
    // Two tasks on July 15 → badge reads "2 tasks".
    const july15Badge = screen.getByTestId('calendar-badge-2026-07-15');
    expect(july15Badge.textContent).toMatch(/2 tasks/);
    // One task on July 20 → badge reads "1 task".
    const july20Badge = screen.getByTestId('calendar-badge-2026-07-20');
    expect(july20Badge.textContent).toMatch(/1 task/);
  });

  it('shows the skeleton while the first fetch is in flight', () => {
    const queryClient = makeQueryClient();
    vi.mocked(tasksHttp.list).mockReturnValue(new Promise(() => undefined));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>
          <AnalyticsProvider>
            <CalendarView
              workspaceSlug="ws"
              workspaceId="ws-1"
              projectSlug="p"
              projectId="p-1"
              currentUserId="u-1"
              currentUserRole="MEMBER"
              workspaceTimezone="UTC"
            />
          </AnalyticsProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Loading calendar…')).toBeInTheDocument();
  });

  it('shows the per-month empty banner when the filtered set has no dated tasks', async () => {
    // Only undated tasks → no bucket keys → banner surfaces + every
    // day cell renders with a 0 task-count data attribute (no badge).
    renderCalendar([
      taskFactory({ id: 't-a', number: 1, dueDate: null }),
      taskFactory({ id: 't-b', number: 2, dueDate: null }),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-empty-month')).toBeInTheDocument();
    });
    // Every rendered day button carries data-task-count="0".
    const cells = document.querySelectorAll(
      '[data-testid^="calendar-day-"]',
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.getAttribute('data-task-count')).toBe('0');
    }
    // No badge should have rendered anywhere.
    expect(
      document.querySelectorAll('[data-testid^="calendar-badge-"]').length,
    ).toBe(0);
  });

  it('excludes tasks with null dueDate from every day cell', async () => {
    renderCalendar([
      taskFactory({
        id: 't-dated',
        number: 1,
        title: 'Dated task',
        dueDate: '2026-07-15T10:00:00Z',
      }),
      taskFactory({
        id: 't-undated',
        number: 2,
        title: 'Undated task',
        dueDate: null,
      }),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });
    // The dated task's preview is visible on the July 15 cell.
    // Scope to the grid — the weekly rail also lists the title.
    const grid = screen.getByTestId('calendar-view');
    expect(within(grid).getByText('Dated task')).toBeInTheDocument();
    // The undated task's title MUST NOT appear anywhere on screen.
    expect(screen.queryByText('Undated task')).not.toBeInTheDocument();
    // Only one badge total — the dated one.
    expect(
      document.querySelectorAll('[data-testid^="calendar-badge-"]').length,
    ).toBe(1);
  });
});

describe('CalendarView — day panel + drawer', () => {
  it('opens DayPanel on cell click and lists the day tasks', async () => {
    renderCalendar([
      taskFactory({
        id: 't-a',
        number: 5,
        title: 'Alpha',
        dueDate: '2026-07-15T10:00:00Z',
      }),
      taskFactory({
        id: 't-b',
        number: 6,
        title: 'Beta',
        dueDate: '2026-07-15T14:00:00Z',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('calendar-view')).toBeInTheDocument(),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = screen.getByTestId('calendar-day-2026-07-15');
    await user.click(cell);
    // Panel + its list surface after click.
    const panel = await screen.findByTestId('calendar-day-panel');
    expect(panel).toBeInTheDocument();
    const list = within(panel).getByTestId('calendar-day-panel-list');
    expect(within(list).getByText('Alpha')).toBeInTheDocument();
    expect(within(list).getByText('Beta')).toBeInTheDocument();
  });

  it('weekly rail groups visible-month tasks by ISO week and opens the drawer on click', async () => {
    // System time is 2026-07-15 — the calendar defaults to July.
    // July 15 (Wednesday) is in ISO week 29; July 8 (Wednesday) is in
    // ISO week 28. Task on 2026-08-01 must NOT appear (outside month).
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({
        id: 't-rail',
        number: 77,
        title: 'Rail week 29 task',
        dueDate: '2026-07-15T10:00:00Z',
      }),
    );
    renderCalendar([
      taskFactory({
        id: 't-w28',
        number: 71,
        title: 'Week 28 task',
        dueDate: '2026-07-08T10:00:00Z',
      }),
      taskFactory({
        id: 't-rail',
        number: 77,
        title: 'Rail week 29 task',
        dueDate: '2026-07-15T10:00:00Z',
      }),
      taskFactory({
        id: 't-aug',
        number: 90,
        title: 'August task',
        dueDate: '2026-08-01T10:00:00Z',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('calendar-view')).toBeInTheDocument(),
    );
    const rail = screen.getByTestId('calendar-weekly-rail');
    // Both July tasks show up — August is out of the visible month.
    expect(within(rail).getByText('Week 28 task')).toBeInTheDocument();
    expect(within(rail).getByText('Rail week 29 task')).toBeInTheDocument();
    expect(within(rail).queryByText('August task')).not.toBeInTheDocument();
    // Rail is organized by week header.
    expect(within(rail).getByTestId('calendar-weekly-rail-week-28')).toBeInTheDocument();
    expect(within(rail).getByTestId('calendar-weekly-rail-week-29')).toBeInTheDocument();
    // Click the rail task — the drawer opens.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(rail).getByTestId('calendar-weekly-rail-task-77'));
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 77);
    });
  });

  it('opens the shared TaskDrawer when a DayPanel task is clicked', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({
        id: 't-drawer',
        number: 42,
        title: 'Drawer target',
        dueDate: '2026-07-15T10:00:00Z',
      }),
    );
    renderCalendar([
      taskFactory({
        id: 't-drawer',
        number: 42,
        title: 'Drawer target',
        dueDate: '2026-07-15T10:00:00Z',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('calendar-view')).toBeInTheDocument(),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId('calendar-day-2026-07-15'));
    const taskBtn = await screen.findByTestId('calendar-day-panel-task-42');
    await user.click(taskBtn);
    // The drawer routes through `useTask` → `tasksHttp.findByNumber`.
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 42);
    });
  });
});
