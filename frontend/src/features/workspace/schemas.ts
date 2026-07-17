import { z } from 'zod';

const slugField = z
  .string()
  .trim()
  .min(2, 'slug.min')
  .max(48, 'slug.max')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug.format');

const nameField = z.string().trim().min(2, 'name.min').max(80, 'name.max');

export const CreateWorkspaceSchema = z.object({
  name: nameField,
  slug: slugField,
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const WorkspaceSettingsSchema = z.object({
  name: nameField,
  slug: slugField,
});
export type WorkspaceSettingsInput = z.infer<typeof WorkspaceSettingsSchema>;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);
}
