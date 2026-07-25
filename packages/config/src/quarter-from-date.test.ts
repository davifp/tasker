import { describe, it, expect } from 'vitest';
import { quarterFromDate } from './quarter-from-date';
import { FISCAL_YEAR_OFFSETS_MONTHS, QUARTER_ID_REGEXP } from './roadmap';

describe('quarterFromDate — calendar year (offset 0)', () => {
  it('maps January into Q1', () => {
    expect(quarterFromDate(new Date('2026-01-15T12:00:00Z'), { fiscalYearOffsetMonths: 0 })).toBe(
      '2026-Q1',
    );
  });

  it('maps March into Q1', () => {
    expect(quarterFromDate(new Date('2026-03-31T23:59:59Z'), { fiscalYearOffsetMonths: 0 })).toBe(
      '2026-Q1',
    );
  });

  it('maps April into Q2', () => {
    expect(quarterFromDate(new Date('2026-04-01T00:00:00Z'), { fiscalYearOffsetMonths: 0 })).toBe(
      '2026-Q2',
    );
  });

  it('maps July into Q3', () => {
    expect(quarterFromDate(new Date('2026-07-15T00:00:00Z'), { fiscalYearOffsetMonths: 0 })).toBe(
      '2026-Q3',
    );
  });

  it('maps December into Q4', () => {
    expect(quarterFromDate(new Date('2026-12-31T23:59:59Z'), { fiscalYearOffsetMonths: 0 })).toBe(
      '2026-Q4',
    );
  });
});

describe('quarterFromDate — fiscal year starting April (offset 3)', () => {
  it('rolls January back into the previous FY Q4', () => {
    expect(quarterFromDate(new Date('2026-01-15T12:00:00Z'), { fiscalYearOffsetMonths: 3 })).toBe(
      '2025-Q4',
    );
  });

  it('rolls March back into the previous FY Q4', () => {
    expect(quarterFromDate(new Date('2026-03-31T23:59:59Z'), { fiscalYearOffsetMonths: 3 })).toBe(
      '2025-Q4',
    );
  });

  it('maps April into the current FY Q1', () => {
    expect(quarterFromDate(new Date('2026-04-01T00:00:00Z'), { fiscalYearOffsetMonths: 3 })).toBe(
      '2026-Q1',
    );
  });

  it('maps June into Q1', () => {
    expect(quarterFromDate(new Date('2026-06-30T23:59:59Z'), { fiscalYearOffsetMonths: 3 })).toBe(
      '2026-Q1',
    );
  });

  it('maps July into Q2', () => {
    expect(quarterFromDate(new Date('2026-07-01T00:00:00Z'), { fiscalYearOffsetMonths: 3 })).toBe(
      '2026-Q2',
    );
  });
});

describe('quarterFromDate — offset 9 (fiscal year starting October)', () => {
  it('maps October into Q1', () => {
    expect(quarterFromDate(new Date('2026-10-01T00:00:00Z'), { fiscalYearOffsetMonths: 9 })).toBe(
      '2026-Q1',
    );
  });

  it('maps September into the previous FY Q4', () => {
    expect(quarterFromDate(new Date('2026-09-30T23:59:59Z'), { fiscalYearOffsetMonths: 9 })).toBe(
      '2025-Q4',
    );
  });

  it('maps January into the previous FY Q2', () => {
    expect(quarterFromDate(new Date('2026-01-15T00:00:00Z'), { fiscalYearOffsetMonths: 9 })).toBe(
      '2025-Q2',
    );
  });
});

describe('quarterFromDate — property tests', () => {
  it('returns a `YYYY-Qn` id for every day in a leap year across every supported offset', () => {
    const days: Date[] = [];
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(Date.UTC(2024, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= daysInMonth; d++) {
        days.push(new Date(Date.UTC(2024, m, d)));
      }
    }

    for (const offset of FISCAL_YEAR_OFFSETS_MONTHS) {
      for (const day of days) {
        const q = quarterFromDate(day, { fiscalYearOffsetMonths: offset });
        expect(QUARTER_ID_REGEXP.test(q)).toBe(true);
      }
    }
  });

  it('produces exactly four unique quarters across a full year for every offset', () => {
    for (const offset of FISCAL_YEAR_OFFSETS_MONTHS) {
      const seen = new Set<string>();
      for (let m = 0; m < 12; m++) {
        // Pick a mid-month date — avoids any accidental month-boundary weirdness.
        seen.add(
          quarterFromDate(new Date(Date.UTC(2026, m, 15)), { fiscalYearOffsetMonths: offset }),
        );
      }
      expect(seen.size).toBe(4);
    }
  });
});

describe('quarterFromDate — invalid input', () => {
  it('throws on a non-Date value', () => {
    // @ts-expect-error — invalid input by construction
    expect(() => quarterFromDate('2026-01-01', { fiscalYearOffsetMonths: 0 })).toThrow(TypeError);
  });

  it('throws on an invalid Date', () => {
    expect(() => quarterFromDate(new Date('not-a-date'), { fiscalYearOffsetMonths: 0 })).toThrow(
      TypeError,
    );
  });
});
