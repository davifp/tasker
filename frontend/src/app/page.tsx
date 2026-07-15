import { HomeDemo } from '@/components/home-demo';

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Tasker</h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Multi-tenant project management SaaS — Phase 0 foundation
        </p>
      </div>

      <HomeDemo />

      <div className="grid w-full max-w-xl gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Primary</h2>
          <div className="mt-2 h-8 rounded bg-primary" aria-hidden="true" />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Accent</h2>
          <div className="mt-2 h-8 rounded bg-accent" aria-hidden="true" />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Destructive</h2>
          <div className="mt-2 h-8 rounded bg-destructive" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
