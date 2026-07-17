import { describe, it, expect } from 'vitest';
import { CreateWorkspaceSchema, slugify } from './schemas';

describe('slugify', () => {
  it('lowercases, strips accents, and converts spaces', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
    expect(slugify('São Paulo Devs')).toBe('sao-paulo-devs');
  });

  it('collapses consecutive separators and trims edges', () => {
    expect(slugify('  hello   world!  ')).toBe('hello-world');
  });
});

describe('CreateWorkspaceSchema', () => {
  it('accepts a well-formed name and slug', () => {
    expect(CreateWorkspaceSchema.safeParse({ name: 'Acme', slug: 'acme' }).success).toBe(true);
  });

  it('rejects an invalid slug', () => {
    expect(CreateWorkspaceSchema.safeParse({ name: 'Acme', slug: 'A cme' }).success).toBe(false);
    expect(CreateWorkspaceSchema.safeParse({ name: 'Acme', slug: '-bad' }).success).toBe(false);
    expect(CreateWorkspaceSchema.safeParse({ name: 'Acme', slug: 'x' }).success).toBe(false);
  });
});
