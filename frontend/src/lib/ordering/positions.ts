import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// Browser-side mirror of backend/src/common/ordering/positions.ts. Keep the
// two in sync: the frontend computes tentative keys for optimistic Kanban
// moves; the backend re-validates and can regenerate under contention.
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
