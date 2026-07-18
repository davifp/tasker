interface ProjectTabPlaceholderProps {
  title: string;
  body: string;
}

// Shared placeholder body for the three inactive tabs (list, backlog,
// timeline). The route file supplies the localized copy; keeping the
// visual shell here means the future implementation of any of those
// tabs only replaces the page.tsx, not the layout scaffold.
export function ProjectTabPlaceholder({ title, body }: ProjectTabPlaceholderProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
