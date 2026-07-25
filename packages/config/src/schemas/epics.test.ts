import { describe, it, expect } from 'vitest';
import {
  createEpicSchema,
  listEpicsQuerySchema,
  roadmapQuerySchema,
  updateEpicSchema,
} from './epics';

describe('createEpicSchema', () => {
  const valid = {
    title: 'Planning MVP',
    startQuarter: '2026-Q3',
    endQuarter: '2026-Q4',
  };

  it('accepts a well-formed epic', () => {
    const parsed = createEpicSchema.parse(valid);
    expect(parsed.status).toBe('PLANNED');
  });

  it('accepts a single-quarter epic', () => {
    expect(createEpicSchema.parse({ ...valid, endQuarter: '2026-Q3' }).endQuarter).toBe('2026-Q3');
  });

  it('rejects an inverted quarter range', () => {
    expect(() =>
      createEpicSchema.parse({ ...valid, startQuarter: '2026-Q4', endQuarter: '2026-Q1' }),
    ).toThrow();
  });

  it('rejects a malformed quarter id', () => {
    expect(() => createEpicSchema.parse({ ...valid, endQuarter: '2026Q4' })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() =>
      createEpicSchema.parse({ ...valid, status: 'IN_REVIEW' as unknown as 'PLANNED' }),
    ).toThrow();
  });
});

describe('updateEpicSchema', () => {
  it('accepts a title-only patch', () => {
    expect(updateEpicSchema.parse({ title: 'Renamed' }).title).toBe('Renamed');
  });

  it('rejects an empty patch', () => {
    expect(() => updateEpicSchema.parse({})).toThrow();
  });

  it('rejects a patch with an inverted quarter range', () => {
    expect(() =>
      updateEpicSchema.parse({ startQuarter: '2027-Q1', endQuarter: '2026-Q4' }),
    ).toThrow();
  });
});

describe('roadmapQuerySchema', () => {
  it('accepts an empty query (server picks defaults)', () => {
    expect(roadmapQuerySchema.parse({})).toEqual({});
  });

  it('accepts a valid range', () => {
    const parsed = roadmapQuerySchema.parse({
      fromQuarter: '2026-Q1',
      toQuarter: '2026-Q4',
    });
    expect(parsed.fromQuarter).toBe('2026-Q1');
  });

  it('rejects an inverted range', () => {
    expect(() =>
      roadmapQuerySchema.parse({ fromQuarter: '2027-Q2', toQuarter: '2026-Q1' }),
    ).toThrow();
  });
});

describe('listEpicsQuerySchema', () => {
  it('defaults limit to 50', () => {
    expect(listEpicsQuerySchema.parse({}).limit).toBe(50);
  });

  it('accepts a status filter', () => {
    expect(listEpicsQuerySchema.parse({ status: 'DONE' }).status).toBe('DONE');
  });
});
