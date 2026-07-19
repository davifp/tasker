import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface AssigneeBubbleProps {
  userId: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

// Deterministic pastel hue derived from the userId — different users get
// visually distinct bubbles even before the profile join lands. `null`
// renders as an "unassigned" outlined dashed circle.
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function initialFromId(id: string): string {
  const first = id.charAt(0);
  return first ? first.toUpperCase() : '?';
}

export function AssigneeBubble({ userId, size = 'sm', className }: AssigneeBubbleProps) {
  const t = useTranslations('board.assignee');
  const dims = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  if (!userId) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground',
          dims,
          className,
        )}
        aria-label={t('unassigned')}
      >
        ?
      </span>
    );
  }
  const hue = hueFromId(userId);
  return (
    <Avatar className={cn(dims, className)} aria-label={t('assignedTo', { id: userId })}>
      <AvatarFallback
        className="font-medium text-foreground"
        style={{ backgroundColor: `hsl(${hue} 70% 82%)` }}
      >
        {initialFromId(userId)}
      </AvatarFallback>
    </Avatar>
  );
}
