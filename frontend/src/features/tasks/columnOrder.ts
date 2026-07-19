import type { TaskStatus } from '@/lib/http/types';

// Board column order is fixed and shared by KanbanBoard, KanbanColumn,
// the drop-target lookup, and the ARIA live announcements.
export const COLUMN_ORDER: readonly TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const;
