import { Injectable } from '@nestjs/common';

/**
 * A raw mention candidate lifted from Markdown source. The offset points at
 * the '@' character in the original body, so the client can highlight the
 * exact span without re-parsing.
 */
export interface MentionCandidate {
  handle: string;
  offset: number;
}

/**
 * Extracts `@handle` tokens from Markdown source, deliberately skipping:
 *
 * - Fenced code blocks (```/~~~)
 * - Inline code spans (backticks)
 * - Handles inside link/image text where a leading `[` would otherwise cause
 *   false positives (Markdown link syntax embeds our token in an escaped
 *   context that isn't a mention)
 * - Backslash-escaped `\@` sequences
 * - Email addresses (`me@example.com`) — the `@` is not preceded by a valid
 *   trigger character (space, line start, `(`, `>` or start of line)
 *
 * Accepted handle character class: `[a-zA-Z0-9._-]` (1..64 chars). This is
 * intentionally narrow — no unicode — because handles are matched against
 * display-name slugs which the resolver already normalises to this set.
 */
@Injectable()
export class MentionParser {
  extract(markdown: string): MentionCandidate[] {
    const source = markdown;
    const out: MentionCandidate[] = [];
    let i = 0;
    let inFence = false;
    let fenceMarker = '';
    let inInlineCode = false;
    let atLineStart = true;

    while (i < source.length) {
      const ch = source[i]!;
      const rest = source.slice(i);

      // ---- Fenced code block toggles ----
      if (!inInlineCode && atLineStart) {
        const fenceMatch = rest.match(/^(```+|~~~+)/);
        if (fenceMatch) {
          if (!inFence) {
            inFence = true;
            fenceMarker = fenceMatch[1]!;
          } else if (rest.startsWith(fenceMarker)) {
            inFence = false;
            fenceMarker = '';
          }
          i += fenceMatch[0]!.length;
          atLineStart = false;
          continue;
        }
      }

      // ---- Inline code toggle ----
      if (!inFence && ch === '`') {
        inInlineCode = !inInlineCode;
        i++;
        atLineStart = false;
        continue;
      }

      // ---- Line boundaries ----
      if (ch === '\n') {
        i++;
        atLineStart = true;
        continue;
      }

      // ---- Escaped @ ----
      if (!inFence && !inInlineCode && ch === '\\' && source[i + 1] === '@') {
        i += 2;
        atLineStart = false;
        continue;
      }

      // ---- Mention candidate ----
      if (!inFence && !inInlineCode && ch === '@') {
        const prev = i === 0 ? '\n' : source[i - 1]!;
        // Trigger context: line start, whitespace, `(`, or `>`. Prevents
        // email `local@domain` from being consumed.
        if (prev === '\n' || /\s|\(|>/.test(prev)) {
          const tail = source.slice(i + 1);
          const m = tail.match(/^([a-zA-Z0-9._-]{1,64})/);
          if (m) {
            out.push({ handle: m[1]!, offset: i });
            i += 1 + m[0]!.length;
            atLineStart = false;
            continue;
          }
        }
      }

      i++;
      atLineStart = false;
    }

    return dedupeByHandle(out);
  }
}

/**
 * When a handle appears multiple times in the same body, keep only the first
 * occurrence — the CommentMention unique(commentId, mentionedUserId)
 * constraint enforces one row per resolved user per comment anyway.
 */
function dedupeByHandle(candidates: MentionCandidate[]): MentionCandidate[] {
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const c of candidates) {
    const key = c.handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
