import { describe, it, expect } from 'vitest';
import {
  formatQuarterId,
  parseQuarterId,
  quarterOrdinal,
  quarterRange,
  shiftQuarter,
  visibleHorizon,
} from './quarter-range';

describe('parseQuarterId / formatQuarterId', () => {
  it('round-trips a well-formed id', () => {
    const parsed = parseQuarterId('2026-Q3');
    expect(parsed).toEqual({ year: 2026, q: 3 });
    expect(formatQuarterId(parsed)).toBe('2026-Q3');
  });

  it('throws on a malformed id', () => {
    expect(() => parseQuarterId('2026Q3')).toThrow();
    expect(() => parseQuarterId('2026-Q5')).toThrow();
  });
});

describe('quarterOrdinal', () => {
  it('is monotonic and consecutive', () => {
    expect(quarterOrdinal('2026-Q4') - quarterOrdinal('2026-Q3')).toBe(1);
    expect(quarterOrdinal('2027-Q1') - quarterOrdinal('2026-Q4')).toBe(1);
  });
});

describe('quarterRange', () => {
  it('returns an inclusive range', () => {
    expect(quarterRange('2026-Q3', '2027-Q1')).toEqual(['2026-Q3', '2026-Q4', '2027-Q1']);
  });

  it('returns a single quarter when from = to', () => {
    expect(quarterRange('2026-Q3', '2026-Q3')).toEqual(['2026-Q3']);
  });

  it('returns empty for an inverted range', () => {
    expect(quarterRange('2027-Q1', '2026-Q3')).toEqual([]);
  });
});

describe('shiftQuarter', () => {
  it('advances across year boundary', () => {
    expect(shiftQuarter('2026-Q4', 1)).toBe('2027-Q1');
  });
  it('rewinds across year boundary', () => {
    expect(shiftQuarter('2026-Q1', -1)).toBe('2025-Q4');
  });
});

describe('visibleHorizon', () => {
  it('starts at the current fiscal quarter and spans lookahead + 1 quarters', () => {
    const day = new Date('2026-07-15T12:00:00Z');
    // calendar year offset (0) → Q3 in July.
    const horizon = visibleHorizon(day, 0, 4);
    expect(horizon[0]).toBe('2026-Q3');
    expect(horizon).toHaveLength(5); // start + 4 lookahead
  });
});
