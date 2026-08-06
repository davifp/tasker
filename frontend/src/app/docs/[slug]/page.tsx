import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { listAdrs, readAdr } from '../lib/adr-catalog';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const adrs = await listAdrs();
  return adrs.map((adr) => ({ slug: adr.slug }));
}

export default async function DocPage({ params }: PageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const doc = await readAdr(slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link
        href="/docs"
        className="mb-6 inline-block text-sm text-muted-foreground hover:underline"
      >
        ← Back to all ADRs
      </Link>
      <article className="prose prose-neutral max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {doc.markdown}
        </ReactMarkdown>
      </article>
    </main>
  );
}
