// GitHub renders `<!-- ... -->` comments in Markdown as HTML comments and
// hides them from the viewer, so we can stamp each mirrored comment with an
// invisible provenance marker. The inbound webhook parses this marker to
// skip loop echoes — the same comment arriving back from GitHub is dropped
// rather than re-mirrored.
const MARKER_PREFIX = '<!--tasker:comment=';
const MARKER_SUFFIX = '-->';

export function buildProvenanceMarker(commentId: string): string {
  return `${MARKER_PREFIX}${commentId}${MARKER_SUFFIX}`;
}

/** Wraps the body with the marker on a trailing newline for readability. */
export function stampProvenance(body: string, commentId: string): string {
  const marker = buildProvenanceMarker(commentId);
  return `${body.trimEnd()}\n\n${marker}\n`;
}

/**
 * Returns the Tasker comment id embedded in a mirrored GitHub body, or null
 * if the body was authored on GitHub (no marker). Matches only well-formed
 * markers — `<!--tasker:comment=cuid-here-->` — so a raw substring in a
 * legitimate comment cannot masquerade as a marker.
 */
export function extractProvenance(body: string | null | undefined): string | null {
  if (!body) return null;
  const startIdx = body.indexOf(MARKER_PREFIX);
  if (startIdx === -1) return null;
  const endIdx = body.indexOf(MARKER_SUFFIX, startIdx + MARKER_PREFIX.length);
  if (endIdx === -1) return null;
  const id = body.slice(startIdx + MARKER_PREFIX.length, endIdx);
  // The Tasker comment id is a cuid — restrict to word characters so a body
  // ending in `<!--tasker:comment=<script>--></a>` cannot inject a false id.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

/**
 * Parse a `owner/repo#N` reference. Returns null if the shape doesn't match
 * exactly one `#` between two well-formed segments. Case-insensitive on the
 * owner/repo path because GitHub is case-insensitive there.
 */
export function parseIssueRef(raw: string): { owner: string; repo: string; number: number } | null {
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})#(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const [, owner, repo, numberStr] = match;
  const number = Number.parseInt(numberStr!, 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { owner: owner!, repo: repo!, number };
}
