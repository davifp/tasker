import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Pure wrapper around fractional-indexing for the Kanban board's position keys.
 *
 * Each key is a lexicographically-sortable string; inserting between two keys
 * only allocates a fresh key, never rewrites the surrounding column. Pass
 * `null` on either side for the column head or tail.
 *
 * Throws when `a >= b` (invalid ordering), matching the upstream contract.
 */
export const Positions = {
  between(a: string | null, b: string | null): string {
    if (a !== null && b !== null && a >= b) {
      throw new Error(`Positions.between: invalid ordering — "${a}" >= "${b}"`);
    }
    return generateKeyBetween(a, b);
  },

  nBetween(a: string | null, b: string | null, n: number): string[] {
    if (n < 0 || !Number.isInteger(n)) {
      throw new RangeError(`n must be a non-negative integer, got ${n}`);
    }
    if (n === 0) return [];
    return generateNKeysBetween(a, b, n);
  },
};

export type PositionsApi = typeof Positions;
