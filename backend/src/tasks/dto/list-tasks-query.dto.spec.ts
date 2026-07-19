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
