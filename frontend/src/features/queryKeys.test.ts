import { describe, it, expect } from 'vitest';
import { canonicalize, taskKeys, type TaskFilters } from './queryKeys';

describe('canonicalize', () => {
  it('sorts labelIds ascending', () => {
    const out = canonicalize({ labelIds: ['b', 'a', 'c'] });
    expect(out).toEqual({ labelIds: ['a', 'b', 'c'] });
  });

  it('sorts status ascending', () => {
    const out = canonicalize({ status: ['TODO', 'DONE', 'BACKLOG'] });
    expect(out).toEqual({ status: ['BACKLOG', 'DONE', 'TODO'] });
  });

  it('sorts priority ascending', () => {
    const out = canonicalize({ priority: ['LOW', 'HIGH', 'MEDIUM'] });
    expect(out).toEqual({ priority: ['HIGH', 'LOW', 'MEDIUM'] });
  });

  it('drops undefined, null, empty-string and empty-array keys', () => {
    const out = canonicalize({
      status: [],
      labelIds: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assigneeUserId: null as unknown as any,
      from: '',
      to: '2026-01-01',
    });
    expect(out).toEqual({ to: '2026-01-01' });
  });

  it('does not mutate the caller input', () => {
    const input: TaskFilters = { labelIds: ['b', 'a'] };
    canonicalize(input);
    expect(input.labelIds).toEqual(['b', 'a']);
  });

  it('freezes the returned object so cache-key consumers cannot mutate it', () => {
    const out = canonicalize({ labelIds: ['a'] });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('permuted-array filter sets produce structurally equal outputs', () => {
    const a = canonicalize({ labelIds: ['b', 'a'] });
    const b = canonicalize({ labelIds: ['a', 'b'] });
    expect(a).toEqual(b);
  });
});

describe('taskKeys.list', () => {
  it('hashes equal (JSON.stringify) for permuted labelIds', () => {
    const a = taskKeys.list('ws', 'p', { labelIds: ['b', 'a'] });
    const b = taskKeys.list('ws', 'p', { labelIds: ['a', 'b'] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('hashes equal across permutations of every canonical array', () => {
    const a = taskKeys.list('ws', 'p', {
      status: ['TODO', 'DONE'],
      labelIds: ['x', 'a'],
      priority: ['MEDIUM', 'HIGH'],
    });
    const b = taskKeys.list('ws', 'p', {
      priority: ['HIGH', 'MEDIUM'],
      labelIds: ['a', 'x'],
      status: ['DONE', 'TODO'],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('undefined vs missing produce identical keys', () => {
    const withUndef = taskKeys.list('ws', 'p', { status: undefined, labelIds: undefined });
    const withoutKeys = taskKeys.list('ws', 'p', {});
    expect(JSON.stringify(withUndef)).toBe(JSON.stringify(withoutKeys));
  });

  it('empty arrays produce a key equal to the empty-filter key', () => {
    const empty = taskKeys.list('ws', 'p', { status: [], labelIds: [] });
    const bare = taskKeys.list('ws', 'p');
    expect(JSON.stringify(empty)).toBe(JSON.stringify(bare));
  });

  it('different values produce different keys', () => {
    const a = taskKeys.list('ws', 'p', { status: ['TODO'] });
    const b = taskKeys.list('ws', 'p', { status: ['DONE'] });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
