import { describe, it, expect } from 'vitest';
import {
  EPIC_STATUSES,
  FISCAL_YEAR_OFFSETS_MONTHS,
  QUARTER_ID_REGEXP,
  RoadmapConfig,
  ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS,
  ROADMAP_MAX_QUARTERS,
  ROADMAP_MIN_QUARTERS,
  isEpicStatus,
  isQuarterId,
} from './roadmap';

describe('RoadmapConfig', () => {
  it('restricts fiscal-year offsets to 3-month multiples', () => {
    expect(FISCAL_YEAR_OFFSETS_MONTHS).toEqual([0, 3, 6, 9]);
  });

  it('bounds lookahead within [min, max] quarters', () => {
    expect(ROADMAP_MIN_QUARTERS).toBeLessThan(ROADMAP_MAX_QUARTERS);
    expect(ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS).toBeGreaterThanOrEqual(ROADMAP_MIN_QUARTERS);
    expect(ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS).toBeLessThanOrEqual(ROADMAP_MAX_QUARTERS);
  });

  it('lists PLANNED/IN_PROGRESS/DONE/CANCELED as the epic lifecycle', () => {
    expect(EPIC_STATUSES).toEqual(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELED']);
  });

  it('exposes a frozen bundled snapshot', () => {
    expect(Object.isFrozen(RoadmapConfig)).toBe(true);
  });
});

describe('QUARTER_ID_REGEXP', () => {
  it('accepts YYYY-Qn format', () => {
    for (const q of ['2026-Q1', '2026-Q4', '2000-Q2']) {
      expect(QUARTER_ID_REGEXP.test(q)).toBe(true);
    }
  });

  it('rejects invalid quarter ids', () => {
    for (const q of ['2026-q1', '2026-Q0', '2026-Q5', '26-Q1', '2026-1', 'Q1-2026']) {
      expect(QUARTER_ID_REGEXP.test(q)).toBe(false);
    }
  });
});

describe('isQuarterId', () => {
  it('is a strict, case-sensitive guard', () => {
    expect(isQuarterId('2026-Q1')).toBe(true);
    expect(isQuarterId('2026-q1')).toBe(false);
    expect(isQuarterId(null)).toBe(false);
    expect(isQuarterId(undefined)).toBe(false);
  });
});

describe('isEpicStatus', () => {
  it('accepts every documented status', () => {
    for (const s of EPIC_STATUSES) {
      expect(isEpicStatus(s)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isEpicStatus('planned')).toBe(false);
    expect(isEpicStatus('READY')).toBe(false);
    expect(isEpicStatus(0)).toBe(false);
  });
});
