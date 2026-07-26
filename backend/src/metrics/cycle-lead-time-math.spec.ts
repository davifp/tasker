import { describe, it, expect } from 'vitest';
import { CycleLeadTimeMath } from './cycle-lead-time-math';

// Reference timezone with no DST transitions in our test windows.
const UTC = 'UTC';

describe('CycleLeadTimeMath.businessHoursBetween — UTC baseline', () => {
  it('returns 0 for reversed range', () => {
    const later = new Date('2026-07-06T12:00:00Z');
    const earlier = new Date('2026-07-06T10:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(later, earlier, UTC)).toBe(0);
  });

  it('measures a same-day interval that fits inside business hours', () => {
    // Monday 10:00 → Monday 15:00 = 5 business hours.
    const from = new Date('2026-07-06T10:00:00Z');
    const to = new Date('2026-07-06T15:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(5);
  });

  it('clamps a same-day interval that starts before business hours', () => {
    // Monday 07:00 → Monday 12:00 = clamps to 09:00 → 12:00 = 3 hours.
    const from = new Date('2026-07-06T07:00:00Z');
    const to = new Date('2026-07-06T12:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(3);
  });

  it('clamps an interval that ends after business hours', () => {
    // Monday 15:00 → Monday 23:00 = clamps to 15:00 → 18:00 = 3 hours.
    const from = new Date('2026-07-06T15:00:00Z');
    const to = new Date('2026-07-06T23:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(3);
  });

  it('skips the weekend', () => {
    // Friday 15:00 → Monday 12:00. Friday: 3h. Sat/Sun: 0. Monday: 3h. = 6h.
    const from = new Date('2026-07-03T15:00:00Z');
    const to = new Date('2026-07-06T12:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(6);
  });

  it('sums multiple full business days', () => {
    // Monday 09:00 → Friday 18:00 = 5 days × 9 hours = 45 hours.
    const from = new Date('2026-07-06T09:00:00Z');
    const to = new Date('2026-07-10T18:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(45);
  });

  it('returns 0 when both ends fall on the same weekend day', () => {
    // Saturday 10:00 → Saturday 15:00.
    const from = new Date('2026-07-04T10:00:00Z');
    const to = new Date('2026-07-04T15:00:00Z');
    expect(CycleLeadTimeMath.businessHoursBetween(from, to, UTC)).toBe(0);
  });
});
