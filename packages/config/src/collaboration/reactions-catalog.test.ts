import { describe, it, expect } from 'vitest';
import { REACTIONS_CATALOG, REACTIONS_GLYPHS, isReactionEmoji } from './reactions-catalog';

describe('REACTIONS_CATALOG', () => {
  it('contains exactly eight entries (per PRD FR-13)', () => {
    expect(REACTIONS_CATALOG).toHaveLength(8);
  });

  it('has a glyph for every catalog entry (no orphans)', () => {
    for (const emoji of REACTIONS_CATALOG) {
      expect(REACTIONS_GLYPHS[emoji]).toBeTruthy();
    }
  });

  it('is a tuple with unique IDs', () => {
    const set = new Set(REACTIONS_CATALOG);
    expect(set.size).toBe(REACTIONS_CATALOG.length);
  });
});

describe('isReactionEmoji', () => {
  it('accepts catalog entries', () => {
    expect(isReactionEmoji('heart')).toBe(true);
    expect(isReactionEmoji('rocket')).toBe(true);
  });

  it('rejects strings outside the catalog', () => {
    expect(isReactionEmoji('poop')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isReactionEmoji(42)).toBe(false);
    expect(isReactionEmoji(null)).toBe(false);
    expect(isReactionEmoji(undefined)).toBe(false);
  });
});
