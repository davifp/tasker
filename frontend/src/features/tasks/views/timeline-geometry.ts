import type { Task } from '@/lib/http/types';

// Pure helpers for Timeline layout math. Kept as a separate module so
// bar `left`/`width` computation and window resolution can be unit-tested
// without spinning up the React component tree.
//
// The window is a rolling N-week span (2 or 4) starting from the ISO
// week (Monday) that contains `today`. All math runs in UTC epoch ms so
// browser TZ never leaks in — dates on `Task` are treated as calendar
// day markers, not instants.

export type WindowWeeks = 2 | 4;

export interface TimelineWindow {
  // Inclusive UTC start of the window (midnight of the ISO-week Monday
  // containing `today`).
  start: Date;
  // Exclusive UTC end of the window (start + weeks * 7 days).
  end: Date;
  weeks: WindowWeeks;
  // Cached `end.getTime() - start.getTime()` — used as the denominator
  // for `left`/`width` percentages, hoisted so callers avoid the
  // subtraction per-bar.
  durationMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Return the UTC midnight of the ISO-week Monday that contains `today`.
// ISO weeks start on Monday: `Date.prototype.getUTCDay()` returns 0
// (Sun)..6 (Sat), so the offset from Monday is `(day + 6) % 7`.
function startOfIsoWeekUtc(today: Date): Date {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  const midnight = Date.UTC(y, m, d);
  const dayOfWeek = new Date(midnight).getUTCDay();
  const offsetFromMonday = (dayOfWeek + 6) % 7;
  return new Date(midnight - offsetFromMonday * MS_PER_DAY);
}

/**
 * Resolve the visible timeline window from the current instant and the
 * chosen window size.
 */
export function resolveWindow(today: Date, weeks: WindowWeeks): TimelineWindow {
  const start = startOfIsoWeekUtc(today);
  const end = new Date(start.getTime() + weeks * 7 * MS_PER_DAY);
  return {
    start,
    end,
    weeks,
    durationMs: end.getTime() - start.getTime(),
  };
}

// Parse an incoming ISO date-string to a UTC midnight instant so
// same-day tasks with different HH:mm portions collate identically.
// Accepts both `YYYY-MM-DD` (returned by date pickers) and full ISO
// datetimes (backend `startDate` / `dueDate`).
function toUtcMidnight(iso: string): number | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
}

export interface BarGeometry {
  // Percentage from the window's left edge (0..100).
  leftPct: number;
  // Percentage of the window's width (0..100). Guaranteed to satisfy
  // `leftPct + widthPct <= 100` after clipping. Additionally floored at
  // `MIN_BAR_PCT` so a same-day task (`startDate === dueDate`) stays
  // clickable even on the 4-week window / narrow viewports.
  widthPct: number;
  // The clipped range in absolute UTC ms — useful for bar aria labels.
  visibleStartMs: number;
  visibleEndMs: number;
  // True when either end of the task interval extends beyond the
  // window (used to render a "continues" affordance on the bar edge).
  clippedLeft: boolean;
  clippedRight: boolean;
}

// Minimum bar width, as a percentage of the visible window. Guarantees
// that a same-day task (`startDate === dueDate`) still renders as a
// tappable target at typical viewport widths (~4–6 px). Below this
// floor, the bar becomes visually indistinguishable from the day-grid
// vertical rules.
export const MIN_BAR_PCT = 1.5;

/**
 * Compute the clipped bar geometry for a task with both endpoints set.
 * Returns `null` when the task's interval falls entirely outside the
 * visible window OR either endpoint is unparseable — callers skip these
 * tasks (they either belong in the "no dates" section or are invalid).
 *
 * Formula:
 *   visibleStart = max(taskStart, windowStart)
 *   visibleEnd   = min(taskEnd,   windowEnd)
 *   left%        = (visibleStart - windowStart) / windowDuration
 *   width%       = (visibleEnd   - visibleStart) / windowDuration
 *
 * A task spanning a boundary renders as ONE continuous bar (visibleEnd
 * clips at `windowEnd`, visibleStart clips at `windowStart`) — never
 * split, never duplicated.
 */
export function computeBarGeometry(
  startIso: string,
  endIso: string,
  window: TimelineWindow,
): BarGeometry | null {
  const startMs = toUtcMidnight(startIso);
  const endMsRaw = toUtcMidnight(endIso);
  if (startMs === null || endMsRaw === null) return null;
  // Treat `dueDate` as INCLUSIVE — a task due on the last day of the
  // window still gets its full day of width. Add one day to the end so
  // the `[start, end)` clipping math renders "through end of day".
  const endMs = endMsRaw + MS_PER_DAY;
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  if (endMs <= windowStartMs) return null;
  if (startMs >= windowEndMs) return null;
  const visibleStartMs = Math.max(startMs, windowStartMs);
  const visibleEndMs = Math.min(endMs, windowEndMs);
  const leftPct = ((visibleStartMs - windowStartMs) / window.durationMs) * 100;
  const rawWidthPct =
    ((visibleEndMs - visibleStartMs) / window.durationMs) * 100;
  // Floor the width so a same-day task never shrinks below the tappable
  // minimum. Same-day math (`endMs - startMs = MS_PER_DAY`) yields
  // 7.14 % on a 2-week window and 3.57 % on a 4-week window; both are
  // already above the floor, but explicit is safer than implicit for
  // edge cases (narrow viewports, future 8-week window).
  const widthPct = Math.max(rawWidthPct, MIN_BAR_PCT);
  return {
    leftPct,
    widthPct,
    visibleStartMs,
    visibleEndMs,
    clippedLeft: startMs < windowStartMs,
    clippedRight: endMs > windowEndMs,
  };
}

export interface DatedTask {
  task: Task;
  geometry: BarGeometry;
}

/**
 * Split a task list into three bins so the UI can render each case with
 * the correct semantic surface:
 *
 * - `dated`     — both dates set AND at least partially inside the
 *                 window; renders as a bar.
 *
 * - `undated`   — task lacks `startDate`, `dueDate`, or both. Surfaces
 *                 in the "No dates" section beneath the chart. Matches
 *                 the task-file wording exactly.
 *
 * - `outsideWindow` — both dates set but the interval falls FULLY
 *                     outside the visible window. Semantically distinct
 *                     from `undated`: the user did set dates, the
 *                     current window just doesn't intersect them. The
 *                     UI renders these as a count-only chip so no task
 *                     silently disappears when the window toggles,
 *                     without polluting the "No dates" list with dated
 *                     entries.
 */
export function partitionTasks(
  tasks: readonly Task[],
  window: TimelineWindow,
): { dated: DatedTask[]; undated: Task[]; outsideWindow: Task[] } {
  const dated: DatedTask[] = [];
  const undated: Task[] = [];
  const outsideWindow: Task[] = [];
  for (const task of tasks) {
    if (!task.startDate || !task.dueDate) {
      undated.push(task);
      continue;
    }
    const geometry = computeBarGeometry(task.startDate, task.dueDate, window);
    if (!geometry) {
      outsideWindow.push(task);
      continue;
    }
    dated.push({ task, geometry });
  }
  return { dated, undated, outsideWindow };
}

/**
 * Build the axis header cells — one per day in the window. Each cell
 * carries the UTC midnight of the day (for keying + aria labels) and a
 * boolean marking week starts (for a heavier vertical rule in the CSS
 * grid). The Timeline shell renders exactly `weeks * 7` cells.
 */
export interface AxisCell {
  date: Date;
  isWeekStart: boolean;
  dayIndex: number;
}

export function buildAxisCells(window: TimelineWindow): AxisCell[] {
  const totalDays = window.weeks * 7;
  const cells: AxisCell[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    cells.push({
      date: new Date(window.start.getTime() + i * MS_PER_DAY),
      isWeekStart: i % 7 === 0,
      dayIndex: i,
    });
  }
  return cells;
}
