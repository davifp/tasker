import { describe, it, expect } from 'vitest';
import { SearchService } from './search.service';

// Unit coverage for the pure helpers on SearchService:
//   - cursor encode/decode round-trip (opaque, base64url of JSON)
//   - decode rejects malformed input silently (returns undefined)
//   - `beyondCursor` breaks ties by id when rank equals
//
// All SQL fan-out logic is covered by the integration spec against Postgres —
// unit-mocking `$queryRaw` would only test the type of a Prisma.sql tag.

describe('SearchService (unit)', () => {
  const svc = new SearchService(null as never);
  const anyFor = svc as unknown as {
    encodeCursor: (c: unknown) => string;
    decodeCursor: (raw?: string) => unknown;
    beyondCursor: (hit: unknown, cursor: unknown) => boolean;
    resolveTypes: (input?: string[]) => string[];
  };

  it('round-trips a cursor', () => {
    const original = { r: 0.42, i: 'clabc', t: 'task' };
    const encoded = anyFor.encodeCursor(original);
    expect(encoded).not.toContain('=');
    expect(anyFor.decodeCursor(encoded)).toEqual(original);
  });

  it('decodeCursor returns undefined for garbage', () => {
    expect(anyFor.decodeCursor('not-base64!!')).toBeUndefined();
    expect(anyFor.decodeCursor(Buffer.from('{"nope":true}').toString('base64url'))).toBeUndefined();
  });

  it('decodeCursor rejects unknown entity types', () => {
    const encoded = Buffer.from(JSON.stringify({ r: 1, i: 'x', t: 'comment' })).toString(
      'base64url',
    );
    expect(anyFor.decodeCursor(encoded)).toBeUndefined();
  });

  it('resolveTypes defaults to all four entity types', () => {
    expect(anyFor.resolveTypes(undefined)).toEqual(['task', 'project', 'member', 'sprint']);
    expect(anyFor.resolveTypes([])).toEqual(['task', 'project', 'member', 'sprint']);
    expect(anyFor.resolveTypes(['task'])).toEqual(['task']);
  });

  it('beyondCursor picks lower rank OR higher id on tie', () => {
    const cursor = { r: 0.5, i: 'clm' };
    expect(anyFor.beyondCursor({ rank: 0.4, id: 'aa' }, cursor)).toBe(true);
    expect(anyFor.beyondCursor({ rank: 0.6, id: 'zz' }, cursor)).toBe(false);
    expect(anyFor.beyondCursor({ rank: 0.5, id: 'clz' }, cursor)).toBe(true);
    expect(anyFor.beyondCursor({ rank: 0.5, id: 'cla' }, cursor)).toBe(false);
  });
});
