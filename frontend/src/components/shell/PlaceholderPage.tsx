import type { LucideIcon } from 'lucide-react';

interface PlaceholderPageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  comingSoon: string;
}

export function PlaceholderPage({
  icon: Icon,
  title,
  description,
  comingSoon,
}: PlaceholderPageProps) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2 text-primary">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">{comingSoon}</p>
      </div>
    </section>
  );
}
