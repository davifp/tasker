import {
  Anchor,
  Beaker,
  BookOpen,
  Bug,
  Calendar,
  Compass,
  Flame,
  Layers,
  LayoutDashboard,
  Package,
  Rocket,
  Sparkles,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import type { ProjectIcon as ProjectIconName } from './schemas';

const REGISTRY: Record<ProjectIconName, LucideIcon> = {
  Package,
  Rocket,
  LayoutDashboard,
  Sparkles,
  Flame,
  Compass,
  Anchor,
  Beaker,
  Bug,
  BookOpen,
  Calendar,
  Layers,
};

interface ProjectIconProps extends Omit<LucideProps, 'ref'> {
  name: string;
}

// Map a stored icon name (persisted in the backend) to the Lucide
// component. Unknown values fall back to Package so an outdated client
// never shows a blank card.
export function ProjectIcon({ name, ...props }: ProjectIconProps) {
  const Icon = (REGISTRY as Record<string, LucideIcon>)[name] ?? Package;
  return <Icon {...props} />;
}
