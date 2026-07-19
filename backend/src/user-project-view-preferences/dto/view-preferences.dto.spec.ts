import { describe, expect, it } from 'vitest';
import { UpdateViewPreferencesDto, viewPreferencesSchema } from './view-preferences.dto';

// The DTO class stores the underlying schema on `.schema` (nestjs-zod
// convention). We assert both the exported schema and the DTO wrapper's
// schema behave identically so the wire contract stays consistent between
// direct-service callers and the HTTP path.
const dtoSchema = (UpdateViewPreferencesDto as unknown as { schema: import('zod').ZodType }).schema;

describe('viewPreferencesSchema — happy paths', () => {
  it('accepts a fully populated payload', () => {
    const input = {
      defaultView: 'list' as const,
      list: {
        columns: ['title', 'assignee', 'priority', 'dueDate'],
        hidden: ['status'],
        sort: { by: 'dueDate', dir: 'asc' as const },
      },
      timeline: { windowWeeks: 4 as const },
      filtersMemo: {
        status: ['TODO' as const, 'IN_PROGRESS' as const],
        assigneeUserId: 'me',
        labelIds: ['lbl-1', 'lbl-2'],
        priority: ['HIGH' as const],
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
        sort: 'dueDate' as const,
        sortDir: 'asc' as const,
      },
    };
    const parsed = viewPreferencesSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(dtoSchema.parse(input)).toEqual(input);
  });

  it('accepts the empty object as a legal no-op payload', () => {
    expect(viewPreferencesSchema.parse({})).toEqual({});
  });

  it('accepts a partial patch (single top-level branch)', () => {
    expect(viewPreferencesSchema.parse({ defaultView: 'backlog' })).toEqual({
      defaultView: 'backlog',
    });
  });

  it('accepts timeline.windowWeeks = 2 and = 4', () => {
    expect(viewPreferencesSchema.parse({ timeline: { windowWeeks: 2 } })).toEqual({
      timeline: { windowWeeks: 2 },
    });
    expect(viewPreferencesSchema.parse({ timeline: { windowWeeks: 4 } })).toEqual({
      timeline: { windowWeeks: 4 },
    });
  });
});

describe('viewPreferencesSchema — unknown-key stripping', () => {
  it('strips unknown top-level keys (Zod default .strip())', () => {
    const parsed = viewPreferencesSchema.parse({
      defaultView: 'list',
      // Unknown top-level keys are silently dropped — the write path returns
      // 200 with the stripped payload so a mixed-version client can trickle
      // experimental keys without breaking older backends.
      experimentalGridLayout: { cellSize: 12 },
      anotherUnknown: 'x',
    });
    expect(parsed).toEqual({ defaultView: 'list' });
    expect('experimentalGridLayout' in parsed).toBe(false);
  });

  it('strips unknown keys inside `list`', () => {
    const parsed = viewPreferencesSchema.parse({
      list: {
        columns: ['title'],
        hidden: [],
        sort: { by: 'title', dir: 'asc' },
        density: 'compact',
      },
    });
    expect(parsed.list).toEqual({
      columns: ['title'],
      hidden: [],
      sort: { by: 'title', dir: 'asc' },
    });
  });

  it('strips unknown keys inside `filtersMemo`', () => {
    const parsed = viewPreferencesSchema.parse({
      filtersMemo: { status: ['TODO'], mysteryKey: true },
    });
    expect(parsed.filtersMemo).toEqual({ status: ['TODO'] });
  });
});

describe('viewPreferencesSchema — invalid input', () => {
  it('rejects an invalid `defaultView` enum value', () => {
    const result = viewPreferencesSchema.safeParse({ defaultView: 'kanban' });
    expect(result.success).toBe(false);
  });

  it('rejects `timeline.windowWeeks` outside {2, 4}', () => {
    expect(viewPreferencesSchema.safeParse({ timeline: { windowWeeks: 3 } }).success).toBe(false);
    expect(viewPreferencesSchema.safeParse({ timeline: { windowWeeks: 8 } }).success).toBe(false);
  });

  it('rejects an invalid `filtersMemo.priority` enum value', () => {
    const result = viewPreferencesSchema.safeParse({
      filtersMemo: { priority: ['CRITICAL'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid `list.sort.dir` enum value', () => {
    const result = viewPreferencesSchema.safeParse({
      list: {
        columns: ['title'],
        hidden: [],
        sort: { by: 'title', dir: 'ASC' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid `filtersMemo.from` (not ISO 8601)', () => {
    const result = viewPreferencesSchema.safeParse({
      filtersMemo: { from: '2026/01/01' },
    });
    expect(result.success).toBe(false);
  });
});

describe('viewPreferencesSchema — size caps', () => {
  it('rejects a `list.columns` array beyond 50 entries', () => {
    const result = viewPreferencesSchema.safeParse({
      list: {
        columns: Array.from({ length: 51 }, (_, i) => `col-${i}`),
        hidden: [],
        sort: { by: 'title', dir: 'asc' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a column name beyond 200 chars', () => {
    const tooLong = 'x'.repeat(201);
    const result = viewPreferencesSchema.safeParse({
      list: {
        columns: [tooLong],
        hidden: [],
        sort: { by: 'title', dir: 'asc' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects `filtersMemo.labelIds` beyond 100 entries', () => {
    const result = viewPreferencesSchema.safeParse({
      filtersMemo: {
        labelIds: Array.from({ length: 101 }, (_, i) => `lbl-${i}`),
      },
    });
    expect(result.success).toBe(false);
  });
});
