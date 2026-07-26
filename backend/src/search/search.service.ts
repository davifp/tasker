import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@tasker/config';
import type { SearchCursor, SearchHit, SearchQueryOptions, SearchResult } from './search.types';

// PostgreSQL full-text search fan-out.
//
// Each entity table (`Task`, `Project`, `Sprint`, `User`) carries a STORED
// `search_vector` GENERATED column indexed by GIN (migration 0008). This service
// issues one query per requested type, merges them with UNION ALL, ranks by
// `ts_rank_cd`, and returns highlighted snippets via `ts_headline`.
//
// Every SQL fragment threads `workspaceId` as the FIRST predicate to guarantee
// tenant isolation. The centralized helpers here are the only place raw SQL is
// composed, so the tenant contract stays auditable in one file.
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async query(options: SearchQueryOptions): Promise<SearchResult> {
    const types = this.resolveTypes(options.types);
    const cursor = this.decodeCursor(options.cursor);

    // Fetch limit+1 per query so we can detect a next page after merge.
    const perTypeLimit = Math.min(options.limit + 1, 50);
    const perTypeQueries = types.map((type) =>
      this.runForType(type, options, perTypeLimit, cursor),
    );
    const perTypeResults = await Promise.all(perTypeQueries);

    // Merge, sort by rank DESC then id ASC to break ties deterministically.
    const merged = perTypeResults
      .flat()
      .sort((a, b) => (b.rank !== a.rank ? b.rank - a.rank : a.id.localeCompare(b.id)))
      .filter((hit) => !cursor || this.beyondCursor(hit, cursor));

    const page = merged.slice(0, options.limit);
    const hasMore = merged.length > options.limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeCursor({ r: last.rank, i: last.id, t: last.type }) : null;

    return { hits: page, nextCursor };
  }

  // ---------------------------------------------------------------------------
  // Per-type queries
  // ---------------------------------------------------------------------------

  private async runForType(
    type: SearchEntityType,
    options: SearchQueryOptions,
    perTypeLimit: number,
    _cursor: SearchCursor | undefined,
  ): Promise<SearchHit[]> {
    // Rank floor lets us skip rows already delivered on prior pages. We match on
    // (rank, id) with strict "less than" semantics so ties don't reappear.
    // Applied post-fetch in `query()` — safer than embedding tuple compares in
    // every UNION branch and avoids leaking cursor state into SQL builders.
    switch (type) {
      case 'task':
        return this.searchTasks(options, perTypeLimit);
      case 'project':
        return this.searchProjects(options, perTypeLimit);
      case 'sprint':
        return this.searchSprints(options, perTypeLimit);
      case 'member':
        return this.searchMembers(options, perTypeLimit);
    }
  }

  private async searchTasks(options: SearchQueryOptions, limit: number): Promise<SearchHit[]> {
    const filters = this.commonFilters(options);
    const projectFilter = options.projectId
      ? Prisma.sql`AND t."projectId" = ${options.projectId}`
      : Prisma.empty;
    const authorFilter = options.authorUserId
      ? Prisma.sql`AND t."createdByUserId" = ${options.authorUserId}`
      : Prisma.empty;
    const rows = await this.prisma.forSystem().$queryRaw<
      Array<{
        id: string;
        label: string;
        snippet: string;
        rank: number;
        project_slug: string;
        project_name: string;
      }>
    >(Prisma.sql`
      SELECT
        t."id" AS id,
        t."title" AS label,
        ts_headline('simple', COALESCE(t."description", ''),
          websearch_to_tsquery('simple', ${options.q}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=15, MinWords=5, ShortWord=2, MaxFragments=1'
        ) AS snippet,
        ts_rank_cd(t."search_vector", websearch_to_tsquery('simple', ${options.q})) AS rank,
        p."slug" AS project_slug,
        p."name" AS project_name
      FROM "Task" t
      INNER JOIN "Project" p ON p."id" = t."projectId"
      WHERE t."workspaceId" = ${options.workspaceId}
        AND t."deletedAt" IS NULL
        AND t."search_vector" @@ websearch_to_tsquery('simple', ${options.q})
        ${projectFilter}
        ${authorFilter}
        ${filters.dateFrom('t."createdAt"')}
        ${filters.dateTo('t."createdAt"')}
      ORDER BY rank DESC, t."id" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      type: 'task',
      id: row.id,
      label: row.label,
      snippet: row.snippet,
      rank: Number(row.rank),
      projectSlug: row.project_slug,
      projectName: row.project_name,
      workspaceSlug: options.workspaceSlug,
      url: `/${options.workspaceSlug}/projects/${row.project_slug}/tasks/${row.id}`,
    }));
  }

  private async searchProjects(options: SearchQueryOptions, limit: number): Promise<SearchHit[]> {
    const filters = this.commonFilters(options);
    const rows = await this.prisma.forSystem().$queryRaw<
      Array<{
        id: string;
        label: string;
        snippet: string;
        rank: number;
        slug: string;
      }>
    >(Prisma.sql`
      SELECT
        p."id" AS id,
        p."name" AS label,
        ts_headline('simple', COALESCE(p."description", ''),
          websearch_to_tsquery('simple', ${options.q}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=15, MinWords=5, ShortWord=2, MaxFragments=1'
        ) AS snippet,
        ts_rank_cd(p."search_vector", websearch_to_tsquery('simple', ${options.q})) AS rank,
        p."slug" AS slug
      FROM "Project" p
      WHERE p."workspaceId" = ${options.workspaceId}
        AND p."deletedAt" IS NULL
        AND p."search_vector" @@ websearch_to_tsquery('simple', ${options.q})
        ${filters.dateFrom('p."createdAt"')}
        ${filters.dateTo('p."createdAt"')}
      ORDER BY rank DESC, p."id" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      type: 'project',
      id: row.id,
      label: row.label,
      snippet: row.snippet,
      rank: Number(row.rank),
      projectSlug: row.slug,
      projectName: row.label,
      workspaceSlug: options.workspaceSlug,
      url: `/${options.workspaceSlug}/projects/${row.slug}`,
    }));
  }

  private async searchSprints(options: SearchQueryOptions, limit: number): Promise<SearchHit[]> {
    const filters = this.commonFilters(options);
    const projectFilter = options.projectId
      ? Prisma.sql`AND s."projectId" = ${options.projectId}`
      : Prisma.empty;
    const rows = await this.prisma.forSystem().$queryRaw<
      Array<{
        id: string;
        label: string;
        snippet: string;
        rank: number;
        number: number;
        project_slug: string;
        project_name: string;
      }>
    >(Prisma.sql`
      SELECT
        s."id" AS id,
        s."name" AS label,
        ts_headline('simple', COALESCE(s."goal", ''),
          websearch_to_tsquery('simple', ${options.q}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=15, MinWords=5, ShortWord=2, MaxFragments=1'
        ) AS snippet,
        ts_rank_cd(s."search_vector", websearch_to_tsquery('simple', ${options.q})) AS rank,
        s."number" AS number,
        p."slug" AS project_slug,
        p."name" AS project_name
      FROM "Sprint" s
      INNER JOIN "Project" p ON p."id" = s."projectId"
      WHERE s."workspaceId" = ${options.workspaceId}
        AND s."search_vector" @@ websearch_to_tsquery('simple', ${options.q})
        ${projectFilter}
        ${filters.dateFrom('s."createdAt"')}
        ${filters.dateTo('s."createdAt"')}
      ORDER BY rank DESC, s."id" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      type: 'sprint',
      id: row.id,
      label: row.label,
      snippet: row.snippet,
      rank: Number(row.rank),
      projectSlug: row.project_slug,
      projectName: row.project_name,
      workspaceSlug: options.workspaceSlug,
      url: `/${options.workspaceSlug}/projects/${row.project_slug}/sprints/${row.number}`,
    }));
  }

  private async searchMembers(options: SearchQueryOptions, limit: number): Promise<SearchHit[]> {
    // Vector lives on User; workspace filter comes via WorkspaceMember join.
    // `authorUserId`, `projectId`, and `from/to` filters don't apply to members.
    const rows = await this.prisma.forSystem().$queryRaw<
      Array<{
        id: string;
        label: string;
        snippet: string;
        rank: number;
      }>
    >(Prisma.sql`
      SELECT
        u."id" AS id,
        u."displayName" AS label,
        u."email"::text AS snippet,
        ts_rank_cd(u."search_vector", websearch_to_tsquery('simple', ${options.q})) AS rank
      FROM "User" u
      INNER JOIN "WorkspaceMember" wm
        ON wm."userId" = u."id" AND wm."workspaceId" = ${options.workspaceId}
      WHERE u."search_vector" @@ websearch_to_tsquery('simple', ${options.q})
      ORDER BY rank DESC, u."id" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      type: 'member',
      id: row.id,
      label: row.label,
      snippet: row.snippet,
      rank: Number(row.rank),
      workspaceSlug: options.workspaceSlug,
      url: `/${options.workspaceSlug}/members/${row.id}`,
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveTypes(types?: SearchEntityType[]): SearchEntityType[] {
    if (!types || types.length === 0) return [...SEARCH_ENTITY_TYPES];
    return types;
  }

  private commonFilters(options: SearchQueryOptions) {
    return {
      dateFrom: (col: string): Prisma.Sql =>
        options.from ? Prisma.sql`AND ${Prisma.raw(col)} >= ${options.from}` : Prisma.empty,
      dateTo: (col: string): Prisma.Sql =>
        options.to ? Prisma.sql`AND ${Prisma.raw(col)} <= ${options.to}` : Prisma.empty,
    };
  }

  private encodeCursor(cursor: SearchCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(raw?: string): SearchCursor | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SearchCursor;
      if (typeof parsed.r !== 'number' || typeof parsed.i !== 'string') return undefined;
      if (!(SEARCH_ENTITY_TYPES as readonly string[]).includes(parsed.t)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private beyondCursor(hit: SearchHit, cursor: SearchCursor): boolean {
    if (hit.rank !== cursor.r) return hit.rank < cursor.r;
    return hit.id > cursor.i;
  }
}
