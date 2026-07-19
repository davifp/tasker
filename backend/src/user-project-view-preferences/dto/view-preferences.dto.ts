import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// -----------------------------------------------------------------------------
// ViewPreferences — durable, per-(user, project) view state
//
// Shape matches `techspec.md` §Data models. Every branch is optional so a
// partial patch is legal; `PUT` shallow-merges the body into the persisted
// object at the top level (replacing whole `list`/`timeline` sub-objects when
// the caller supplies them). Unknown keys are **stripped**, not rejected —
// this is Zod's default `.strip()` behaviour. Rationale: view preferences are
// forward-compatible client state (older backends see a mixed payload from
// a newer client that added an experimental key), and silently discarding the
// unknown key keeps the UI responsive during a rolling deploy. Invalid enum
// values on **known** keys still hard-fail with 400 + Problem Details.
//
// Size caps are enforced at the schema level so a malicious oversized payload
// is rejected before it hits Prisma:
//   - column-name strings ≤ 200 chars, list.columns / list.hidden ≤ 50 items
//   - sort.by ≤ 200 chars, dir constrained to the two enum values
//   - filtersMemo array members ≤ 100 items each; label IDs ≤ 200 chars
//   - filtersMemo `from`/`to` are ISO 8601 datetimes
// -----------------------------------------------------------------------------

const VIEW_ENUM = ['board', 'list', 'backlog', 'calendar', 'timeline'] as const;
const TASK_STATUS_ENUM = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
const PRIORITY_ENUM = ['LOW', 'MEDIUM', 'HIGH'] as const;
const SORT_DIR_ENUM = ['asc', 'desc'] as const;
const SORT_FIELD_ENUM = ['dueDate', 'updatedAt', 'priority', 'title', 'position'] as const;

const COLUMN_NAME_MAX = 200;
const COLUMN_LIST_MAX = 50;
const FILTER_ARRAY_MAX = 100;
const LABEL_ID_MAX = 200;

// `.strip()` is the Zod default but stated explicitly so a future reviewer
// doesn't have to know the default to understand the wire behaviour.
export const viewPreferencesSchema = z
  .object({
    defaultView: z.enum(VIEW_ENUM).optional(),
    list: z
      .object({
        columns: z.array(z.string().max(COLUMN_NAME_MAX)).max(COLUMN_LIST_MAX),
        hidden: z.array(z.string().max(COLUMN_NAME_MAX)).max(COLUMN_LIST_MAX),
        sort: z.object({
          by: z.string().max(COLUMN_NAME_MAX),
          dir: z.enum(SORT_DIR_ENUM),
        }),
      })
      .strip()
      .optional(),
    timeline: z
      .object({
        // The techspec pins the window to {2, 4}; `z.union([z.literal(2), z.literal(4)])`
        // expresses that exact set without allowing 3 or arbitrary integers.
        windowWeeks: z.union([z.literal(2), z.literal(4)]),
      })
      .strip()
      .optional(),
    // `filtersMemo` is the last-applied `TaskFilters` shape. Every field is
    // optional and enforced against the same enums the tasks controller uses,
    // so a memo written today will still parse against a stricter schema
    // tomorrow. Array bounds keep pathological memos from blowing up the
    // JSON column.
    filtersMemo: z
      .object({
        status: z.array(z.enum(TASK_STATUS_ENUM)).max(FILTER_ARRAY_MAX).optional(),
        assigneeUserId: z.string().max(LABEL_ID_MAX).optional(),
        labelIds: z.array(z.string().max(LABEL_ID_MAX)).max(FILTER_ARRAY_MAX).optional(),
        priority: z.array(z.enum(PRIORITY_ENUM)).max(FILTER_ARRAY_MAX).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        sort: z.enum(SORT_FIELD_ENUM).optional(),
        sortDir: z.enum(SORT_DIR_ENUM).optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;

// -----------------------------------------------------------------------------
// DTO wrapper — the `PUT` body is a *partial* patch. Since every field on
// `viewPreferencesSchema` is already optional, the schema doubles as the
// patch schema (no `.partial()` needed). The empty object `{}` is a legal
// no-op patch.
// -----------------------------------------------------------------------------

export class UpdateViewPreferencesDto extends createZodDto(viewPreferencesSchema) {}
