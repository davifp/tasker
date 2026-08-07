import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useMemberDisplayName } from '@/features/members/hooks/useMemberDisplayName';
import { cn } from '@/lib/utils';

interface AssigneeBubbleProps {
  userId: string | null;
  displayName?: string | null;
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

function initialFromName(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return fallback.charAt(0).toUpperCase() || '?';
  return trimmed.charAt(0).toUpperCase();
}

export function AssigneeBubble({
  userId,
  displayName,
  size = 'sm',
  className,
}: AssigneeBubbleProps) {
  const t = useTranslations('board.assignee');
  const resolvedName = useMemberDisplayName(userId);
  const effectiveName = displayName ?? resolvedName;
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
  const name = effectiveName?.trim() || userId;
  return (
    <Avatar className={cn(dims, className)} aria-label={t('assignedTo', { id: name })}>
      <AvatarFallback
        className="font-medium text-foreground"
        style={{ backgroundColor: `hsl(${hue} 70% 82%)` }}
      >
        {initialFromName(effectiveName ?? '', userId)}
      </AvatarFallback>
    </Avatar>
  );
}
