import { describe, it, expect } from 'vitest';
import {
  capacityUpsertSchema,
  createSprintSchema,
  listSprintsQuerySchema,
  sprintNumberParamSchema,
  sprintTasksMutationSchema,
  updateSprintSchema,
} from './sprints';
import { SPRINT_MAX_DAYS_DEFAULT } from '../sprint-policy';

describe('createSprintSchema', () => {
  const valid = {
    name: 'Sprint 42',
    startDate: '2026-07-01',
    endDate: '2026-07-14',
  };

  it('accepts a well-formed create payload', () => {
    expect(createSprintSchema.parse(valid).name).toBe('Sprint 42');
  });

  it('accepts an optional goal', () => {
    expect(createSprintSchema.parse({ ...valid, goal: 'Ship planning MVP' }).goal).toBe(
      'Ship planning MVP',
    );
  });

  it('rejects an empty name', () => {
    expect(() => createSprintSchema.parse({ ...valid, name: '   ' })).toThrow();
  });

  it('rejects an inverted date range', () => {
    expect(() =>
      createSprintSchema.parse({ ...valid, startDate: '2026-07-14', endDate: '2026-07-01' }),
    ).toThrow();
  });

  it('rejects a range longer than SPRINT_MAX_DAYS_DEFAULT', () => {
    const end = new Date('2026-07-01');
    end.setUTCDate(end.getUTCDate() + SPRINT_MAX_DAYS_DEFAULT + 5);
    expect(() =>
      createSprintSchema.parse({ ...valid, endDate: end.toISOString().slice(0, 10) }),
    ).toThrow();
  });

  it('rejects an invalid ISO date', () => {
    expect(() => createSprintSchema.parse({ ...valid, startDate: 'yesterday' })).toThrow();
  });
});

describe('updateSprintSchema', () => {
  it('accepts a partial edit', () => {
    expect(updateSprintSchema.parse({ name: 'Renamed' }).name).toBe('Renamed');
  });

  it('rejects an empty patch', () => {
    expect(() => updateSprintSchema.parse({})).toThrow();
  });
});

describe('sprintTasksMutationSchema', () => {
  it('accepts add-only', () => {
    expect(sprintTasksMutationSchema.parse({ add: ['t1', 't2'] }).add).toHaveLength(2);
  });

  it('accepts remove-only', () => {
    expect(sprintTasksMutationSchema.parse({ remove: ['t3'] }).remove).toEqual(['t3']);
  });

  it('rejects an empty mutation', () => {
    expect(() => sprintTasksMutationSchema.parse({})).toThrow();
    expect(() => sprintTasksMutationSchema.parse({ add: [], remove: [] })).toThrow();
  });

  it('rejects batches over 500', () => {
    const many = Array.from({ length: 501 }, (_, i) => `t${i}`);
    expect(() => sprintTasksMutationSchema.parse({ add: many })).toThrow();
  });
});

describe('capacityUpsertSchema', () => {
  it('accepts a valid batch', () => {
    expect(
      capacityUpsertSchema.parse({
        entries: [
          { memberUserId: 'u1', capacityPoints: 8 },
          { memberUserId: 'u2', capacityPoints: 0 },
        ],
      }).entries,
    ).toHaveLength(2);
  });

  it('rejects negative capacity', () => {
    expect(() =>
      capacityUpsertSchema.parse({ entries: [{ memberUserId: 'u1', capacityPoints: -1 }] }),
    ).toThrow();
  });

  it('rejects an empty batch', () => {
    expect(() => capacityUpsertSchema.parse({ entries: [] })).toThrow();
  });

  it('rejects a missing memberUserId', () => {
    expect(() =>
      // @ts-expect-error — verifying runtime guard, not the type
      capacityUpsertSchema.parse({ entries: [{ capacityPoints: 3 }] }),
    ).toThrow();
  });
});

describe('listSprintsQuerySchema', () => {
  it('defaults limit to 50', () => {
    expect(listSprintsQuerySchema.parse({}).limit).toBe(50);
  });

  it('accepts a state filter', () => {
    expect(listSprintsQuerySchema.parse({ state: 'ACTIVE' }).state).toBe('ACTIVE');
  });

  it('rejects an unknown state', () => {
    expect(() => listSprintsQuerySchema.parse({ state: 'ARCHIVED' })).toThrow();
  });
});

describe('sprintNumberParamSchema', () => {
  it('coerces string numbers', () => {
    expect(sprintNumberParamSchema.parse({ sprintNumber: '7' }).sprintNumber).toBe(7);
  });

  it('rejects a non-positive number', () => {
    expect(() => sprintNumberParamSchema.parse({ sprintNumber: '0' })).toThrow();
    expect(() => sprintNumberParamSchema.parse({ sprintNumber: '-1' })).toThrow();
  });
});
