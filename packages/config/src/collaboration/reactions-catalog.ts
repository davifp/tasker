/**
 * The workspace-wide reactions catalogue. Kept small and frozen so every
 * workspace speaks the same emoji vocabulary. Adding an emoji is a code-review
 * governed change; workspace-defined catalogues are explicitly out of scope
 * (see PRD → "Out of scope") and would break historical reaction counters.
 */

export const REACTIONS_CATALOG = [
  'thumbs_up',
  'thumbs_down',
  'heart',
  'tada',
  'rocket',
  'eyes',
  'check',
  'thinking',
] as const;

export type ReactionEmoji = (typeof REACTIONS_CATALOG)[number];

/**
 * Rendering map — canonical ID → glyph. Kept next to the catalog so clients
 * and integration tests can render without an extra dependency and so a
 * catalog change forces a matching render entry in the same PR.
 */
export const REACTIONS_GLYPHS: Readonly<Record<ReactionEmoji, string>> = Object.freeze({
  thumbs_up: '👍',
  thumbs_down: '👎',
  heart: '❤️',
  tada: '🎉',
  rocket: '🚀',
  eyes: '👀',
  check: '✅',
  thinking: '🤔',
});

const REACTIONS_SET: ReadonlySet<string> = new Set(REACTIONS_CATALOG);

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && REACTIONS_SET.has(value);
}
