import { describe, expect, it } from 'vitest';
import { CreateProjectSchema, PROJECT_COLORS, PROJECT_ICONS, slugifyProjectName } from './schemas';

describe('CreateProjectSchema', () => {
  const valid = {
    name: 'Website relaunch',
    slug: 'website-relaunch',
    color: PROJECT_COLORS[0],
    icon: PROJECT_ICONS[0],
  } as const;

  it('accepts a well-formed input', () => {
    expect(CreateProjectSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = CreateProjectSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('name.min');
    }
  });

  it('rejects a name longer than 80 chars', () => {
    const result = CreateProjectSchema.safeParse({ ...valid, name: 'x'.repeat(81) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('name.max');
    }
  });

  it('rejects a slug with uppercase or underscore', () => {
    const bad = ['Not_Slug', 'BadSlug', '-leading', 'trailing-'];
    for (const slug of bad) {
      const result = CreateProjectSchema.safeParse({ ...valid, slug });
      expect(result.success).toBe(false);
    }
  });

  it('rejects an off-palette color', () => {
    const result = CreateProjectSchema.safeParse({ ...valid, color: '#123456' });
    expect(result.success).toBe(false);
  });

  it('caps the description at 500 chars', () => {
    const result = CreateProjectSchema.safeParse({ ...valid, description: 'x'.repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('description.max');
    }
  });
});

describe('slugifyProjectName', () => {
  it('kebab-cases a plain string', () => {
    expect(slugifyProjectName('Website Relaunch')).toBe('website-relaunch');
  });

  it('strips diacritics', () => {
    expect(slugifyProjectName('Relançamento do Site')).toBe('relancamento-do-site');
  });

  it('collapses multiple separators and trims edges', () => {
    expect(slugifyProjectName('  Website — Relaunch!!  ')).toBe('website-relaunch');
  });

  it('caps at 40 chars', () => {
    expect(slugifyProjectName('a'.repeat(60)).length).toBe(40);
  });
});
