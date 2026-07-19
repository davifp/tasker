import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ViewPreferences, viewPreferencesSchema } from './dto/view-preferences.dto';

// Shallow-merges `patch` into `existing` at the top level. Nested objects
// (`list`, `timeline`, `filtersMemo`) are replaced wholesale, not deep-merged.
// Rationale (matches techspec §API endpoints):
//   - the client always sends a complete sub-object when it changes one field
//     inside (e.g. picking a new List `sort.by` re-sends the whole `list`
//     branch), which keeps write semantics predictable
//   - deep-merging would strand unreachable keys under `list` when the
//     column set shrinks (a removed column would linger in `hidden`)
//   - keys explicitly set to `undefined` in the patch are ignored (Object.entries
//     drops them once the DTO is parsed — Zod does not emit undefined keys)
export function shallowMergeViewPreferences(
  existing: ViewPreferences,
  patch: ViewPreferences,
): ViewPreferences {
  return { ...existing, ...patch };
}

@Injectable()
export class UserProjectViewPreferencesService {
  private readonly logger = new Logger(UserProjectViewPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Returns `{}` when no row exists. The service NEVER surfaces 404 for a
  // missing row — that's the contract the frontend relies on (a fresh
  // workspace/project pair still gets a well-defined empty object).
  async getFor(userId: string, projectId: string): Promise<ViewPreferences> {
    const row = await this.prisma.forSystem().userProjectViewPreference.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!row) return {};
    return this.parseStored(row.prefs, userId, projectId);
  }

  // Shallow-merges the patch into any existing row (or creates one with the
  // patch as the initial value). The stored payload is re-parsed on read AND
  // on write so a shape drift between deploys never returns unvalidated JSON
  // to the wire.
  async upsert(
    userId: string,
    projectId: string,
    patch: ViewPreferences,
  ): Promise<ViewPreferences> {
    const existingRow = await this.prisma.forSystem().userProjectViewPreference.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    const existing = existingRow ? this.parseStored(existingRow.prefs, userId, projectId) : {};
    const merged = shallowMergeViewPreferences(existing, patch);

    await this.prisma.forSystem().userProjectViewPreference.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: {
        userId,
        projectId,
        prefs: merged as Prisma.InputJsonValue,
      },
      update: {
        prefs: merged as Prisma.InputJsonValue,
      },
    });

    return merged;
  }

  // Belt-and-braces parse of the stored JSON — if a legacy row or a manual
  // DB edit slipped an unknown key past the write path, `.strip()` cleans it
  // up on the next read. Invalid persisted data collapses to `{}` rather than
  // 500-ing the caller — but we `warn` so ops can spot rows that need cleanup.
  private parseStored(raw: Prisma.JsonValue, userId: string, projectId: string): ViewPreferences {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = viewPreferencesSchema.safeParse(raw);
    if (result.success) return result.data;
    this.logger.warn(
      { userId, projectId, issues: result.error.issues },
      'stored view preferences failed schema — collapsing to {}',
    );
    return {};
  }
}
