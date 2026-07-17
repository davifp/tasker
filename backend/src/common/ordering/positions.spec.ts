import { describe, it, expect } from 'vitest';
import { Positions } from './positions';

// ---------------------------------------------------------------------------
// Positions.between — known-answer cases
// ---------------------------------------------------------------------------

describe('Positions.between()', () => {
  it('returns the head key when both bounds are null', () => {
    expect(Positions.between(null, null)).toBe('a0');
  });

  it('returns a key strictly greater than the left bound when right is null', () => {
    const a = Positions.between(null, null);
    const next = Positions.between(a, null);
    expect(next > a).toBe(true);
  });

  it('returns a key strictly less than the right bound when left is null', () => {
    const b = Positions.between(null, null);
    const before = Positions.between(null, b);
    expect(before < b).toBe(true);
  });

  it('returns a midpoint key strictly between two adjacent keys', () => {
    const first = Positions.between(null, null);
    const second = Positions.between(first, null);
    const mid = Positions.between(first, second);
    expect(mid > first).toBe(true);
    expect(mid < second).toBe(true);
  });

  it('throws when a >= b', () => {
    expect(() => Positions.between('a1', 'a0')).toThrow();
    expect(() => Positions.between('a0', 'a0')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Positions.nBetween — batch generation
// ---------------------------------------------------------------------------

describe('Positions.nBetween()', () => {
  it('returns an empty array when n=0', () => {
    expect(Positions.nBetween(null, null, 0)).toEqual([]);
  });

  it('returns n distinct keys, all strictly increasing between bounds', () => {
    const keys = Positions.nBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it('honors the lower and upper bounds', () => {
    const outer = Positions.nBetween(null, null, 2);
    const inner = Positions.nBetween(outer[0], outer[1], 3);
    expect(inner[0] > outer[0]).toBe(true);
    expect(inner[inner.length - 1] < outer[1]).toBe(true);
  });

  it('rejects negative n', () => {
    expect(() => Positions.nBetween(null, null, -1)).toThrow(RangeError);
  });

  it('rejects non-integer n', () => {
    expect(() => Positions.nBetween(null, null, 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('property: between(a, b) always yields a < result < b', () => {
  it('holds across 1000 random adjacent-pair midpoints seeded from head→tail keys', () => {
    // Build a spine of 20 head→tail keys, then randomly pick adjacent pairs
    // and mid-insert; the invariant must hold for every insert.
    const spine = Positions.nBetween(null, null, 20);
    for (let i = 0; i < 1000; i++) {
      const idx = Math.floor(Math.random() * (spine.length - 1));
      const left = spine[idx];
      const right = spine[idx + 1];
      const mid = Positions.between(left, right);
      expect(mid > left).toBe(true);
      expect(mid < right).toBe(true);
    }
  });
});

describe('property: 1000 mid-inserts against a bulk-seeded column stay under 32 chars', () => {
  it('random adjacent-pair mid-inserts on a bulk-seeded column keep keys short', () => {
    // Realistic MVP workload: bulk-seed a column via nBetween (the way large
    // imports would land) and then mid-insert into random adjacent pairs.
    // The techspec's 32-char soft alert is a monitoring threshold aimed at
    // adversarial single-pair mid-insert loops — those are called out as a
    // known risk with a per-column rebalance mitigation. This test guards
    // the realistic workload.
    const column: string[] = Positions.nBetween(null, null, 1000);
    let maxLen = 0;
    for (let i = 0; i < 1000; i++) {
      const idx = Math.floor(Math.random() * (column.length - 1));
      const mid = Positions.between(column[idx], column[idx + 1]);
      column.splice(idx + 1, 0, mid);
      maxLen = Math.max(maxLen, mid.length);
    }
    expect(maxLen).toBeLessThan(32);
  });
});
