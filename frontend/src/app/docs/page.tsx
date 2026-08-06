import type { JSX } from 'react';
import Link from 'next/link';
import { listAdrs } from './lib/adr-catalog';

export const dynamic = 'force-static';
export const revalidate = 3600;

export default async function DocsIndex(): Promise<JSX.Element> {
  const adrs = await listAdrs();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Architecture decision records</h1>
        <p className="mt-3 text-muted-foreground">
          Every non-obvious choice this project made — why we picked it, what we ruled out, and how
          to change your mind later.
        </p>
      </header>
      {adrs.length === 0 ? (
        <p className="text-muted-foreground">No ADRs available yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {adrs.map((adr) => (
            <li key={adr.slug} className="py-4">
              <Link
                href={`/docs/${adr.slug}`}
                className="group flex items-baseline justify-between gap-4"
              >
                <span className="text-lg font-medium group-hover:underline">{adr.title}</span>
                <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {adr.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
