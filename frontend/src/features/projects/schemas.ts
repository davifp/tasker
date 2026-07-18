import { z } from 'zod';

// Curated palette + icon set: keeps the picker to a handful of choices
// so every card in the sidebar reads as a distinct color and a familiar
// shape. Matches the ui-ux-pro-max guidance for Kanban board affordances.

export const PROJECT_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky
  '#64748b', // slate
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const PROJECT_ICONS = [
  'Package',
  'Rocket',
  'LayoutDashboard',
  'Sparkles',
  'Flame',
  'Compass',
  'Anchor',
  'Beaker',
  'Bug',
  'BookOpen',
  'Calendar',
  'Layers',
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];

const nameField = z.string().trim().min(1, 'name.min').max(80, 'name.max');
const slugField = z
  .string()
  .trim()
  .min(2, 'slug.min')
  .max(40, 'slug.max')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug.format');
const colorField = z.enum(PROJECT_COLORS, { message: 'color.format' });
const iconField = z.enum(PROJECT_ICONS, { message: 'icon.required' });
const descriptionField = z.string().trim().max(500, 'description.max').optional();

export const CreateProjectSchema = z.object({
  name: nameField,
  slug: slugField,
  color: colorField,
  icon: iconField,
  description: descriptionField,
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

// Kebab-case slug derived from the project name — the caller can edit
// the derived value in the dialog. Matches the workspace slugify().
export function slugifyProjectName(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      // Strip combining diacritical marks (U+0300–U+036F).
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .slice(0, 40)
  );
}
