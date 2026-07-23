import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MentionCandidate } from './mention-parser';

export interface ResolvedMention {
  userId: string;
  displayName: string;
  handle: string;
  offset: number;
}

export interface MemberSuggestion {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  slug: string;
}

/**
 * Slugifies a display name into the handle character class the parser
 * accepts. Kept as a pure function so tests can pin it independent of DB
 * state.
 *
 * Rules:
 * - lowercased
 * - anything outside `[a-z0-9._-]` collapses to `-`
 * - repeated separators collapsed to a single `-`
 * - trimmed of leading/trailing separators
 */
export function slugifyDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

@Injectable()
export class MentionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves candidates against the workspace member roster. Multiple members
   * with the same slug prefer the earliest-created (deterministic). Handles
   * that match no member are silently dropped — the caller renders them as
   * plain text and no notification is enqueued (per PRD FR-12).
   *
   * Executes read against the caller's transaction client so the resolution
   * happens inside the same tx as the comment write.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    candidates: MentionCandidate[],
  ): Promise<ResolvedMention[]> {
    if (candidates.length === 0) return [];

    const members = await tx.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    const bySlug = new Map<string, { userId: string; displayName: string }>();
    for (const m of members) {
      const slug = slugifyDisplayName(m.user.displayName);
      if (!bySlug.has(slug)) {
        bySlug.set(slug, { userId: m.user.id, displayName: m.user.displayName });
      }
    }

    const out: ResolvedMention[] = [];
    const claimed = new Set<string>();
    for (const c of candidates) {
      const slug = slugifyDisplayName(c.handle);
      const hit = bySlug.get(slug);
      if (!hit) continue;
      if (claimed.has(hit.userId)) continue;
      claimed.add(hit.userId);
      out.push({
        userId: hit.userId,
        displayName: hit.displayName,
        handle: c.handle,
        offset: c.offset,
      });
    }
    return out;
  }

  /**
   * Autocomplete for the composer popover. Strict tenant filter — the WHERE
   * clause carries `workspaceId` explicitly (defense in depth on top of the
   * DMMF-derived tenant extension).
   */
  async search(
    workspaceId: string,
    q: string,
    limit: number,
  ): Promise<MemberSuggestion[]> {
    const members = await this.prisma.forSystem().workspaceMember.findMany({
      where: {
        workspaceId,
        user: q
          ? {
              // ILIKE via Prisma insensitive mode. displayName is not a
              // citext column but Prisma handles this at query build time.
              displayName: { contains: q, mode: 'insensitive' },
            }
          : undefined,
      },
      include: {
        user: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { user: { displayName: 'asc' } },
      take: limit,
    });

    return members.map(m => ({
      userId: m.user.id,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      slug: slugifyDisplayName(m.user.displayName),
    }));
  }
}
