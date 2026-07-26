import { BUSINESS_HOURS } from '@tasker/config';

/**
 * Business-hours arithmetic used by the metrics module to compute lead time
 * (task creation → Done) and cycle time (first transition into In Progress
 * → Done) in the workspace's local timezone. The calculator emits derived
 * columns for `mv_workspace_cycle_lead_time`; keeping the logic in
 * application code sidesteps the brittle timezone + DST handling that
 * would live in a raw SQL definition.
 *
 * Simplifying assumption: the workspace observes the same business-hours
 * window Monday–Friday every day; holidays are not modelled in this phase.
 * `BUSINESS_HOURS.workDays` uses JS `getDay()` semantics (0 = Sunday).
 *
 * Timezone handling: the caller passes an IANA timezone name (e.g.
 * `America/Sao_Paulo`); we use `Intl.DateTimeFormat` to extract wall-clock
 * fields in that zone without pulling in a heavy date library.
 */
export class CycleLeadTimeMath {
  /**
   * Returns the number of business hours between `from` and `to` in the
   * given IANA timezone, honoring `BUSINESS_HOURS.startHour`/`endHour` and
   * `BUSINESS_HOURS.workDays`. Returns 0 when `to <= from`.
   */
  static businessHoursBetween(from: Date, to: Date, timezone: string): number {
    if (to.getTime() <= from.getTime()) return 0;

    const start = this.clampToBusinessOpen(from, timezone);
    const end = this.clampToBusinessClose(to, timezone);
    if (end.getTime() <= start.getTime()) return 0;

    let cursor = start;
    let acc = 0;
    // Iterate day by day. Each iteration adds the overlap between the
    // cursor and either the day's close or `end`, whichever comes first.
    while (cursor.getTime() < end.getTime()) {
      const dayClose = this.endOfBusinessDay(cursor, timezone);
      const chunkEnd = dayClose.getTime() < end.getTime() ? dayClose : end;
      if (this.isBusinessDay(cursor, timezone)) {
        acc += Math.max(0, (chunkEnd.getTime() - cursor.getTime()) / 3_600_000);
      }
      cursor = this.startOfNextBusinessDay(cursor, timezone);
      if (cursor.getTime() > end.getTime()) break;
    }
    return acc;
  }

  // ---------------------------------------------------------------------------
  // Internals — timezone-aware helpers.
  //
  // These use the same `Intl.DateTimeFormat` in a fixed timezone to extract
  // wall-clock fields, then convert back through UTC. Using getUTC* on the
  // resulting Date is safe because the constructor pins each field to UTC.
  // ---------------------------------------------------------------------------

  private static isBusinessDay(date: Date, timezone: string): boolean {
    const day = this.dayInZone(date, timezone);
    return (BUSINESS_HOURS.workDays as readonly number[]).includes(day);
  }

  private static clampToBusinessOpen(date: Date, timezone: string): Date {
    if (!this.isBusinessDay(date, timezone)) {
      return this.startOfNextBusinessDay(date, timezone);
    }
    const wall = this.wallClockInZone(date, timezone);
    if (wall.hour < BUSINESS_HOURS.startHour) {
      return this.dateFromWallClock(
        { ...wall, hour: BUSINESS_HOURS.startHour, minute: 0, second: 0 },
        timezone,
      );
    }
    if (wall.hour >= BUSINESS_HOURS.endHour) {
      return this.startOfNextBusinessDay(date, timezone);
    }
    return date;
  }

  private static clampToBusinessClose(date: Date, timezone: string): Date {
    const wall = this.wallClockInZone(date, timezone);
    if (wall.hour < BUSINESS_HOURS.startHour) {
      // Rewind to previous business day's close.
      return this.endOfPreviousBusinessDay(date, timezone);
    }
    if (wall.hour >= BUSINESS_HOURS.endHour) {
      return this.dateFromWallClock(
        { ...wall, hour: BUSINESS_HOURS.endHour, minute: 0, second: 0 },
        timezone,
      );
    }
    return date;
  }

  private static endOfBusinessDay(date: Date, timezone: string): Date {
    const wall = this.wallClockInZone(date, timezone);
    return this.dateFromWallClock(
      { ...wall, hour: BUSINESS_HOURS.endHour, minute: 0, second: 0 },
      timezone,
    );
  }

  private static startOfNextBusinessDay(date: Date, timezone: string): Date {
    let cursor = this.addDays(date, 1, timezone);
    while (!this.isBusinessDay(cursor, timezone)) {
      cursor = this.addDays(cursor, 1, timezone);
    }
    const wall = this.wallClockInZone(cursor, timezone);
    return this.dateFromWallClock(
      { ...wall, hour: BUSINESS_HOURS.startHour, minute: 0, second: 0 },
      timezone,
    );
  }

  private static endOfPreviousBusinessDay(date: Date, timezone: string): Date {
    let cursor = this.addDays(date, -1, timezone);
    while (!this.isBusinessDay(cursor, timezone)) {
      cursor = this.addDays(cursor, -1, timezone);
    }
    const wall = this.wallClockInZone(cursor, timezone);
    return this.dateFromWallClock(
      { ...wall, hour: BUSINESS_HOURS.endHour, minute: 0, second: 0 },
      timezone,
    );
  }

  private static dayInZone(date: Date, timezone: string): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const weekdayShort = fmt.format(date);
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayShort] ?? 0;
  }

  private static wallClockInZone(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === t)?.value ?? 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') === 24 ? 0 : get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }

  private static dateFromWallClock(
    wall: {
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
    },
    timezone: string,
  ): Date {
    // Approximate the UTC instant matching the wall-clock time by iterating
    // once: compose a UTC Date from the wall fields, then correct for the
    // timezone offset. One iteration converges except on the exact DST
    // transition minute — good enough for business-hours math where we
    // pin the boundary at 09:00/18:00.
    const utcGuess = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const guessDate = new Date(utcGuess);
    const observed = this.wallClockInZone(guessDate, timezone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const offset = utcGuess - observedUtc;
    return new Date(utcGuess + offset);
  }

  private static addDays(date: Date, days: number, timezone: string): Date {
    const wall = this.wallClockInZone(date, timezone);
    return this.dateFromWallClock({ ...wall, day: wall.day + days }, timezone);
  }
}
