/**
 * Cross-field invariant tests for the task DTOs.
 *
 * Locks the `startDate <= dueDate` contract on both `CreateTaskDto` and
 * `UpdateTaskDto`. The check is expressed with a `.refine` on the object
 * schema so Zod attaches the error at `startDate` (the value the caller
 * would edit) rather than at the object root — this matches the shape
 * consumed by the Problem Details exception filter.
 */
import { describe, it, expect } from 'vitest';
import { CreateTaskDto } from './create-task.dto';
import { UpdateTaskDto } from './update-task.dto';

const createSchema = (CreateTaskDto as unknown as { schema: import('zod').ZodType }).schema;
const updateSchema = (UpdateTaskDto as unknown as { schema: import('zod').ZodType }).schema;

const isoStart = '2026-07-01T00:00:00.000Z';
const isoDue = '2026-07-15T00:00:00.000Z';

describe('CreateTaskDto — startDate/dueDate invariant', () => {
  it('accepts a valid interval where startDate < dueDate', () => {
    const result = createSchema.safeParse({
      title: 'Ok',
      startDate: isoStart,
      dueDate: isoDue,
    });
    expect(result.success).toBe(true);
  });

  it('accepts equal endpoints (single-day task)', () => {
    const result = createSchema.safeParse({
      title: 'Same day',
      startDate: isoStart,
      dueDate: isoStart,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when startDate > dueDate', () => {
    const result = createSchema.safeParse({
      title: 'Inverted',
      startDate: isoDue,
      dueDate: isoStart,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const found = result.error.issues.some((i) => i.path.includes('startDate'));
      expect(found).toBe(true);
    }
  });

  it('accepts a task with only startDate (no dueDate)', () => {
    const result = createSchema.safeParse({ title: 'Start only', startDate: isoStart });
    expect(result.success).toBe(true);
  });

  it('accepts a task with only dueDate (no startDate)', () => {
    const result = createSchema.safeParse({ title: 'Due only', dueDate: isoDue });
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO startDate', () => {
    const result = createSchema.safeParse({ title: 'Bad', startDate: '2026-07-01' });
    expect(result.success).toBe(false);
  });
});

describe('UpdateTaskDto — startDate/dueDate invariant', () => {
  it('accepts a partial patch that only sets startDate', () => {
    const result = updateSchema.safeParse({ startDate: isoStart });
    expect(result.success).toBe(true);
  });

  it('accepts a null startDate (clear the field)', () => {
    const result = updateSchema.safeParse({ startDate: null });
    expect(result.success).toBe(true);
  });

  it('accepts a null dueDate (clear the field)', () => {
    const result = updateSchema.safeParse({ dueDate: null });
    expect(result.success).toBe(true);
  });

  it('rejects a patch where startDate > dueDate', () => {
    const result = updateSchema.safeParse({ startDate: isoDue, dueDate: isoStart });
    expect(result.success).toBe(false);
  });

  it('rejects an empty patch (existing "at least one field" refine)', () => {
    const result = updateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
