import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// ADRs live at `<repo>/docs/adr/` — outside the frontend workspace. In dev
// `process.cwd()` is `frontend/`; the sibling directory is one level up. The
// standalone production build includes them via `outputFileTracingIncludes`
// in next.config.ts.
const ADR_DIR = path.resolve(process.cwd(), '..', 'docs', 'adr');

export interface AdrEntry {
  slug: string;
  title: string;
  status: string;
}

export interface AdrDocument extends AdrEntry {
  markdown: string;
}

export async function listAdrs(): Promise<AdrEntry[]> {
  const files = await readdir(ADR_DIR).catch(() => []);
  const md = files.filter((f) => f.endsWith('.md')).sort();
  return Promise.all(
    md.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = await readFile(path.join(ADR_DIR, file), 'utf8');
      return { slug, title: extractTitle(raw, slug), status: extractStatus(raw) };
    }),
  );
}

export async function readAdr(slug: string): Promise<AdrDocument | null> {
  // Slug-vs-filename equality closes off directory traversal (`..`, `/`).
  const safe = slug.replace(/[^a-z0-9-]/gi, '');
  if (safe !== slug) return null;
  const raw = await readFile(path.join(ADR_DIR, `${slug}.md`), 'utf8').catch(() => null);
  if (!raw) return null;
  return { slug, title: extractTitle(raw, slug), status: extractStatus(raw), markdown: raw };
}

function extractTitle(raw: string, fallback: string): string {
  const match = raw.match(/^#\s+(.+?)\s*$/m);
  return match?.[1] ?? fallback;
}

function extractStatus(raw: string): string {
  const match = raw.match(/^##\s*Status\s*\n+([^\n]+)/m);
  return match?.[1]?.trim() ?? 'Unknown';
}
