import { describe, it, expect } from 'vitest';
import { ListTasksQueryDto } from './list-tasks-query.dto';

// Zod is invoked directly on the DTO schema; the class wrapper stores the
// underlying schema on `.schema` (nestjs-zod convention). We exercise the
// schema rather than the full Nest pipe stack — enough to lock the shape
// of the wire contract for `?labels=` and adjacent legacy params.
const schema = (ListTasksQueryDto as unknown as { schema: import('zod').ZodType }).schema;

describe('ListTasksQueryDto — labels', () => {
  const validCuid = 'cktzy3upu0000v3jqrgxi9k3l';
  const anotherCuid = 'cktzy3upu0001v3jqrgxi9k4m';

  it('parses a single-value labels query into a one-element array', () => {
    const parsed = schema.parse({ labels: validCuid });
    expect((parsed as { labels?: string[] }).labels).toEqual([validCuid]);
  });

  it('parses a comma-separated labels query and trims whitespace', () => {
    const parsed = schema.parse({ labels: `${validCuid}, ${anotherCuid}` });
    expect((parsed as { labels?: string[] }).labels).toEqual([validCuid, anotherCuid]);
  });

  it('collapses to undefined when the value is an empty string', () => {
    const parsed = schema.parse({ labels: '' });
    expect((parsed as { labels?: string[] }).labels).toBeUndefined();
  });

  it('rejects a labels query containing a non-CUID entry', () => {
    const result = schema.safeParse({ labels: `${validCuid},not-a-cuid` });
    expect(result.success).toBe(false);
  });

  it('accepts the request without a labels key at all', () => {
    const parsed = schema.parse({});
    expect((parsed as { labels?: string[] }).labels).toBeUndefined();
  });
});

describe('ListTasksQueryDto — priority', () => {
  it('parses a single-value priority query into a one-element array', () => {
    const parsed = schema.parse({ priority: 'HIGH' });
    expect((parsed as { priority?: string[] }).priority).toEqual(['HIGH']);
  });

  it('parses a comma-separated priority query and trims whitespace', () => {
    const parsed = schema.parse({ priority: 'HIGH, MEDIUM' });
    expect((parsed as { priority?: string[] }).priority).toEqual(['HIGH', 'MEDIUM']);
  });

  it('collapses to undefined when the value is an empty string', () => {
    const parsed = schema.parse({ priority: '' });
    expect((parsed as { priority?: string[] }).priority).toBeUndefined();
  });

  it('rejects a priority query containing an unknown enum value', () => {
    const result = schema.safeParse({ priority: 'HIGH,URGENT' });
    expect(result.success).toBe(false);
  });
});

describe('ListTasksQueryDto — sort / sortDir', () => {
  it('accepts each documented sort field', () => {
    for (const s of ['dueDate', 'updatedAt', 'priority', 'title', 'position'] as const) {
      const parsed = schema.parse({ sort: s });
      expect((parsed as { sort?: string }).sort).toBe(s);
    }
  });

  it('accepts asc and desc as sortDir', () => {
    for (const d of ['asc', 'desc'] as const) {
      const parsed = schema.parse({ sortDir: d });
      expect((parsed as { sortDir?: string }).sortDir).toBe(d);
    }
  });

  it('rejects an unknown sort value', () => {
    const result = schema.safeParse({ sort: 'random' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown sortDir value', () => {
    const result = schema.safeParse({ sortDir: 'random' });
    expect(result.success).toBe(false);
  });

  it('omits sort/sortDir when unset (service applies default)', () => {
    const parsed = schema.parse({});
    expect((parsed as { sort?: string }).sort).toBeUndefined();
    expect((parsed as { sortDir?: string }).sortDir).toBeUndefined();
  });
});

describe('ListTasksQueryDto — from / to', () => {
  it('accepts a valid ISO datetime for from and to', () => {
    const parsed = schema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
    });
    expect((parsed as { from?: string; to?: string }).from).toBe('2026-07-01T00:00:00.000Z');
    expect((parsed as { from?: string; to?: string }).to).toBe('2026-07-31T23:59:59.999Z');
  });

  it('rejects a non-ISO from value', () => {
    const result = schema.safeParse({ from: '2026/07/01' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO to value', () => {
    const result = schema.safeParse({ to: 'yesterday' });
    expect(result.success).toBe(false);
  });
});
