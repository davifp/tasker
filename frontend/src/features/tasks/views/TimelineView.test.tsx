import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import type { CursorPage, Task, TaskStatus } from '@/lib/http/types';
import {
  buildAxisCells,
  computeBarGeometry,
  MIN_BAR_PCT,
  partitionTasks,
  resolveWindow,
} from './timeline-geometry';

const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => routerReplace(...args),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/ws/projects/p/timeline',
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
import { TimelineView } from './TimelineView';

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

function renderTimeline(tasks: Task[]) {
  const queryClient = makeQueryClient();
  vi.mocked(tasksHttp.list).mockResolvedValue({
    items: tasks,
    nextCursor: null,
  } satisfies CursorPage<Task>);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider>
          <TimelineView
            workspaceSlug="ws"
            workspaceId="ws-1"
            projectSlug="p"
            projectId="p-1"
            currentUserId="u-1"
            currentUserRole="MEMBER"
          />
        </AnalyticsProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.current = '';
  // 2026-07-15 (Wednesday) — ISO week 29. Window Monday = 2026-07-13.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// A single day, as a percentage of the visible window duration. Kept
// as a helper so the geometry assertions stay legible when the window
// switches between 2 and 4 weeks.
function dayPct(weeks: 2 | 4): number {
  return 100 / (weeks * 7);
}

describe('timeline-geometry — resolveWindow', () => {
  it('anchors the window at the ISO-week Monday containing today', () => {
    // 2026-07-15 is a Wednesday; ISO week starts Monday 2026-07-13.
    const w = resolveWindow(new Date('2026-07-15T12:00:00Z'), 2);
    expect(w.start.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    // 2 weeks × 7 days = 14 days → window ends 2026-07-27 00:00 UTC.
    expect(w.end.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    expect(w.durationMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('expands cleanly to a 4-week window', () => {
    const w = resolveWindow(new Date('2026-07-15T12:00:00Z'), 4);
    expect(w.start.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('lands on Monday when today is Sunday (dayOfWeek = 0 edge case)', () => {
    // 2026-07-19 is Sunday — the ISO week Monday is 2026-07-13, NOT
    // the following Monday. Guards against the classic `getDay() === 0`
    // off-by-one.
    const w = resolveWindow(new Date('2026-07-19T12:00:00Z'), 2);
    expect(w.start.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });
});

describe('timeline-geometry — computeBarGeometry', () => {
  const window = resolveWindow(new Date('2026-07-15T12:00:00Z'), 2);
  const D = dayPct(2);

  it('positions a task fully inside the window with correct left / width', () => {
    // Start Wed 2026-07-15, due Fri 2026-07-17 (3-day span inclusive).
    // Day 2 offset (Wed = day 2 from Mon), width = 3 days.
    const g = computeBarGeometry('2026-07-15', '2026-07-17', window);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.leftPct).toBeCloseTo(2 * D, 5);
    expect(g.widthPct).toBeCloseTo(3 * D, 5);
    expect(g.clippedLeft).toBe(false);
    expect(g.clippedRight).toBe(false);
  });

  it('renders a single continuous bar when the task straddles a WEEK boundary', () => {
    // Task starts W1 day 6 (Sat 2026-07-18), ends W2 day 2 (Tue
    // 2026-07-21). No boundary CLIPPING on a windowWeeks=2 view (the
    // window ends at the end of W2 = 2026-07-27), so both endpoints
    // stay unclipped and the bar is one continuous span across the
    // week seam.
    const g = computeBarGeometry('2026-07-18', '2026-07-21', window);
    expect(g).not.toBeNull();
    if (!g) return;
    // 5 days from Mon 2026-07-13 → Sat 2026-07-18 → leftPct = 5 * D.
    expect(g.leftPct).toBeCloseTo(5 * D, 5);
    // 4 inclusive days (18, 19, 20, 21) → widthPct = 4 * D.
    expect(g.widthPct).toBeCloseTo(4 * D, 5);
    expect(g.clippedLeft).toBe(false);
    expect(g.clippedRight).toBe(false);
  });

  it('clips left when the task starts BEFORE the window and ends INSIDE', () => {
    // Task begins 2026-07-01 (before window), ends 2026-07-17 (inside).
    const g = computeBarGeometry('2026-07-01', '2026-07-17', window);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.leftPct).toBeCloseTo(0, 5);
    // 5 inclusive days visible: 13, 14, 15, 16, 17.
    expect(g.widthPct).toBeCloseTo(5 * D, 5);
    expect(g.clippedLeft).toBe(true);
    expect(g.clippedRight).toBe(false);
  });

  it('clips both edges when the interval spans past the window on both sides', () => {
    // Long task: 2026-06-01 → 2026-09-01 fully engulfs the 2-week window.
    const g = computeBarGeometry('2026-06-01', '2026-09-01', window);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.leftPct).toBeCloseTo(0, 5);
    expect(g.widthPct).toBeCloseTo(100, 5);
    expect(g.clippedLeft).toBe(true);
    expect(g.clippedRight).toBe(true);
  });

  it('returns null when the interval is entirely outside the window', () => {
    // Before window: due 2026-07-10 (window starts 2026-07-13).
    expect(computeBarGeometry('2026-07-05', '2026-07-10', window)).toBeNull();
    // After window: starts 2026-08-01 (window ends 2026-07-27).
    expect(computeBarGeometry('2026-08-01', '2026-08-05', window)).toBeNull();
  });

  it('produces a minimum-width bar when startDate === dueDate', () => {
    // Same-day task on a 2-week window would raw-compute to 100/14 ≈
    // 7.14 %, which is comfortably above `MIN_BAR_PCT`. The floor still
    // matters for future 8-week windows and narrow viewports — assert
    // the invariant holds regardless.
    const g = computeBarGeometry('2026-07-15', '2026-07-15', window);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.widthPct).toBeGreaterThanOrEqual(MIN_BAR_PCT);
  });
});

describe('timeline-geometry — buildAxisCells', () => {
  it('emits `weeks * 7` cells with week starts every 7 days', () => {
    const w = resolveWindow(new Date('2026-07-15T12:00:00Z'), 2);
    const cells = buildAxisCells(w);
    expect(cells).toHaveLength(14);
    const first = cells[0];
    const eighth = cells[7];
    const fourth = cells[3];
    const last = cells[13];
    if (!first || !eighth || !fourth || !last) throw new Error('missing axis cell');
    expect(first.isWeekStart).toBe(true);
    expect(eighth.isWeekStart).toBe(true);
    expect(fourth.isWeekStart).toBe(false);
    // First cell = window.start; last cell = window.end - 1 day.
    expect(first.date.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(last.date.toISOString()).toBe('2026-07-26T00:00:00.000Z');
  });
});

describe('timeline-geometry — partitionTasks', () => {
  const window = resolveWindow(new Date('2026-07-15T12:00:00Z'), 2);

  it('routes only-startDate tasks to the undated bucket', () => {
    const task = taskFactory({
      id: 't-a',
      startDate: '2026-07-15',
      dueDate: null,
    });
    const { dated, undated, outsideWindow } = partitionTasks([task], window);
    expect(dated).toHaveLength(0);
    expect(outsideWindow).toHaveLength(0);
    expect(undated).toEqual([task]);
  });

  it('routes only-dueDate tasks to the undated bucket', () => {
    const task = taskFactory({
      id: 't-b',
      startDate: null,
      dueDate: '2026-07-15',
    });
    const { dated, undated, outsideWindow } = partitionTasks([task], window);
    expect(dated).toHaveLength(0);
    expect(outsideWindow).toHaveLength(0);
    expect(undated).toEqual([task]);
  });

  it('routes tasks with both dates but fully outside the window into the outsideWindow bucket (NOT undated)', () => {
    const outside = taskFactory({
      id: 't-out',
      startDate: '2026-05-01',
      dueDate: '2026-05-05',
    });
    const { dated, undated, outsideWindow } = partitionTasks(
      [outside],
      window,
    );
    expect(dated).toHaveLength(0);
    // Critical semantic invariant: dated tasks that scrolled off do
    // NOT pollute the "No dates" bin — the user set dates, the window
    // just doesn't intersect. Chip surface, not list surface.
    expect(undated).toHaveLength(0);
    expect(outsideWindow).toEqual([outside]);
  });

  it('places tasks with both dates AND overlap into the dated bucket', () => {
    const inside = taskFactory({
      id: 't-in',
      startDate: '2026-07-15',
      dueDate: '2026-07-17',
    });
    const { dated, undated, outsideWindow } = partitionTasks(
      [inside],
      window,
    );
    expect(undated).toHaveLength(0);
    expect(outsideWindow).toHaveLength(0);
    expect(dated).toHaveLength(1);
    const [entry] = dated;
    if (!entry) throw new Error('expected a dated task');
    expect(entry.task).toBe(inside);
    expect(entry.geometry.leftPct).toBeGreaterThanOrEqual(0);
    expect(entry.geometry.widthPct).toBeGreaterThan(0);
  });
});

describe('TimelineView — component', () => {
  it('renders bars for dated tasks and the "no dates" section for undated', async () => {
    renderTimeline([
      taskFactory({
        id: 't-in',
        number: 10,
        title: 'Inside window',
        startDate: '2026-07-15',
        dueDate: '2026-07-17',
      }),
      taskFactory({
        id: 't-nostart',
        number: 20,
        title: 'Missing start',
        startDate: null,
        dueDate: '2026-07-16',
      }),
      taskFactory({
        id: 't-nodue',
        number: 21,
        title: 'Missing due',
        startDate: '2026-07-16',
        dueDate: null,
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    // Dated task renders as a positioned bar.
    const bar = screen.getByTestId('timeline-bar-10');
    expect(bar).toBeInTheDocument();
    // Both undated tasks surface in the "no dates" section.
    const noDates = screen.getByTestId('timeline-no-dates');
    expect(
      screen.getByTestId('timeline-no-dates-task-20'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('timeline-no-dates-task-21'),
    ).toBeInTheDocument();
    expect(noDates.textContent).toContain('Missing start');
    expect(noDates.textContent).toContain('Missing due');
  });

  it('routes a task missing an endpoint to the No Dates section', async () => {
    // Test A — task lacks `dueDate`; belongs semantically in "No dates".
    renderTimeline([
      taskFactory({
        id: 't-nodue',
        number: 25,
        title: 'Half-planned task',
        startDate: '2026-07-15',
        dueDate: null,
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('timeline-bar-25')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('timeline-no-dates-task-25'),
    ).toBeInTheDocument();
    // Chip stays hidden — no dated tasks scrolled off.
    expect(
      screen.queryByTestId('timeline-outside-window'),
    ).not.toBeInTheDocument();
  });

  it('routes a task with both dates but fully outside the window to the Outside-Window chip (NOT No Dates)', async () => {
    // Test B — task has both dates, just past the 2-week window end
    // (2026-07-27). Belongs in the count-only chip, not the "No dates"
    // list.
    renderTimeline([
      taskFactory({
        id: 't-future',
        number: 30,
        title: 'Next month task',
        // Window end = 2026-07-27; use +5 days past the end.
        startDate: '2026-08-01',
        dueDate: '2026-08-05',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('timeline-bar-30')).not.toBeInTheDocument();
    // Key semantic invariant: the dated-but-hidden task MUST NOT show
    // up in the "No dates" list — that surface is reserved for tasks
    // missing an endpoint.
    expect(
      screen.queryByTestId('timeline-no-dates-task-30'),
    ).not.toBeInTheDocument();
    // Chip renders with the count.
    const chip = screen.getByTestId('timeline-outside-window');
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute('data-count')).toBe('1');
  });

  it('renders a single continuous bar for a task straddling a window boundary', async () => {
    renderTimeline([
      taskFactory({
        id: 't-cross',
        number: 40,
        title: 'Cross boundary',
        // Starts 2 days before window (2026-07-11), ends day 3 of
        // window (2026-07-15). Left must clip to 0 and width must
        // cover 3 inclusive days (13, 14, 15).
        startDate: '2026-07-11',
        dueDate: '2026-07-15',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    const bars = screen.getAllByTestId('timeline-bar-40');
    // EXACTLY one bar — never split, never duplicated.
    expect(bars).toHaveLength(1);
    const [bar] = bars;
    if (!bar) throw new Error('bar missing');
    const leftPct = Number(bar.getAttribute('data-left-pct'));
    const widthPct = Number(bar.getAttribute('data-width-pct'));
    const D = dayPct(2);
    expect(leftPct).toBeCloseTo(0, 4);
    expect(widthPct).toBeCloseTo(3 * D, 4);
    expect(bar.getAttribute('data-clipped-left')).toBe('true');
  });

  it('renders a single continuous bar for the success-criterion straddle example (W1d6 → W3d2, 2-week window)', async () => {
    // Fixed clock: 2026-07-15 (Wed) → ISO-week Monday 2026-07-13.
    // 2-week window ends EXCLUSIVELY at 2026-07-27.
    //   W1 day 6 = Sat 2026-07-18 (Mon + 5 days).
    //   W2 day 7 = Sun 2026-07-26 (last day inside the window).
    //   W3 day 2 = Tue 2026-07-28 — one day PAST the window's inclusive
    //     end (2026-07-26), so `endMs > windowEndMs` → clippedRight.
    //
    // Success criterion (task file, line 5): "A task with startDate =
    // W1-day-6 and dueDate = W3-day-2 renders as one bar in the
    // windowWeeks=2 view (not two)."
    renderTimeline([
      taskFactory({
        id: 't-strad',
        number: 42,
        title: 'Straddle W1d6 → W3d2',
        startDate: '2026-07-18',
        dueDate: '2026-07-28',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    const bars = screen.getAllByTestId('timeline-bar-42');
    // EXACTLY one bar — never split into two W1 / W2 halves.
    expect(bars).toHaveLength(1);
    const [bar] = bars;
    if (!bar) throw new Error('bar missing');
    const leftPct = Number(bar.getAttribute('data-left-pct'));
    const widthPct = Number(bar.getAttribute('data-width-pct'));
    const D = dayPct(2);
    // Left = day 5 offset (Sat 2026-07-18 = Mon + 5 days).
    expect(leftPct).toBeCloseTo(5 * D, 4);
    // Visible width covers days 18..26 (9 inclusive days) → clipped at
    // the window's right edge.
    expect(widthPct).toBeCloseTo(9 * D, 4);
    // Right edge is clipped; left is not.
    expect(bar.getAttribute('data-clipped-right')).toBe('true');
    expect(bar.getAttribute('data-clipped-left')).toBe(null);
  });

  it('toggling the window from 2w to 4w does NOT re-fetch tasks', async () => {
    renderTimeline([
      taskFactory({
        id: 't-in',
        number: 50,
        title: 'Reused across toggle',
        startDate: '2026-07-15',
        dueDate: '2026-07-17',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    // First mount already triggered one fetch.
    expect(tasksHttp.list).toHaveBeenCalledTimes(1);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId('timeline-window-4w'));
    // Window changed — but the shared cache entry is keyed by filter
    // set, not by window. Zero additional requests.
    await waitFor(() => {
      const view = screen.getByTestId('timeline-view');
      expect(view.getAttribute('data-window-weeks')).toBe('4');
    });
    expect(tasksHttp.list).toHaveBeenCalledTimes(1);
    // Window param persisted via router.replace (URL survives refresh).
    expect(routerReplace).toHaveBeenCalled();
  });

  it('clicking a bar opens the shared TaskDrawer', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({
        id: 't-in',
        number: 60,
        title: 'Drawer target',
        startDate: '2026-07-15',
        dueDate: '2026-07-17',
      }),
    );
    renderTimeline([
      taskFactory({
        id: 't-in',
        number: 60,
        title: 'Drawer target',
        startDate: '2026-07-15',
        dueDate: '2026-07-17',
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId('timeline-bar-60'));
    // Drawer routes through `useTask` → `tasksHttp.findByNumber`.
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 60);
    });
  });

  it('surfaces the empty state when there are no tasks at all', async () => {
    renderTimeline([]);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-view')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });
});
