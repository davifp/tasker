import { describe, it, expect } from 'vitest';
import {
  burndownQuerySchema,
  cycleLeadTimeQuerySchema,
  dashboardRefreshBodySchema,
} from './dashboard';

describe('cycleLeadTimeQuerySchema', () => {
  it('defaults window to last_quarter', () => {
    expect(cycleLeadTimeQuerySchema.parse({}).window).toBe('last_quarter');
  });

  it('accepts a valid explicit range', () => {
    const parsed = cycleLeadTimeQuerySchema.parse({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-03-31T23:59:59.000Z',
    });
    expect(parsed.from).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects a partial range (from without to)', () => {
    expect(() => cycleLeadTimeQuerySchema.parse({ from: '2026-01-01T00:00:00.000Z' })).toThrow();
  });

  it('rejects an inverted range', () => {
    expect(() =>
      cycleLeadTimeQuerySchema.parse({
        from: '2026-03-31T23:59:59.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects an unknown preset', () => {
    expect(() =>
      // @ts-expect-error — verifying runtime rejection
      cycleLeadTimeQuerySchema.parse({ window: 'last_decade' }),
    ).toThrow();
  });
});

describe('burndownQuerySchema', () => {
  it('defaults includeIdeal to true', () => {
    expect(burndownQuerySchema.parse({}).includeIdeal).toBe(true);
  });

  it('coerces string booleans', () => {
    expect(burndownQuerySchema.parse({ includeIdeal: 'false' }).includeIdeal).toBe(false);
  });
});

describe('dashboardRefreshBodySchema', () => {
  it('accepts an empty body', () => {
    expect(dashboardRefreshBodySchema.parse({})).toEqual({});
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => dashboardRefreshBodySchema.parse({ hey: 1 })).toThrow();
  });
});
