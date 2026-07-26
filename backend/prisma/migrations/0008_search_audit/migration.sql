-- Phase 7 — Search & Audit
--
-- Two independent additions that share a migration for release atomicity:
--   1. `AuditLog.targetType` + `(workspaceId, targetType, createdAt DESC)`
--      composite index — lets the audit viewer filter by entity type without
--      decoding the JSON `metadata` payload.
--   2. Weighted `search_vector` GENERATED STORED columns on `Task`, `Project`,
--      `Sprint`, and `User`, each with a GIN index. These power the workspace
--      global search (⌘K + /search) via `SearchService`. Kept out of
--      `schema.prisma` because Prisma has no first-class DSL for generated
--      columns; the Prisma client never reads or writes them directly.

-- ---------------------------------------------------------------------------
-- 1. AuditLog additive changes
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "AuditLog"
  ADD COLUMN "targetType" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_targetType_createdAt_idx"
  ON "AuditLog" ("workspaceId", "targetType", "createdAt" DESC);

-- ---------------------------------------------------------------------------
-- 2. Search vectors
--
-- Weight `A` for the primary label (title / name / displayName),
-- weight `B` for the secondary body (description / goal / email).
-- Config `'simple'` avoids language stemming so identifier-like tokens
-- (task codes, project keys) remain searchable verbatim.
-- ---------------------------------------------------------------------------

-- Task
ALTER TABLE "Task"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "Task_search_vector_idx"
  ON "Task" USING GIN ("search_vector");

-- Project
ALTER TABLE "Project"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "Project_search_vector_idx"
  ON "Project" USING GIN ("search_vector");

-- Sprint
ALTER TABLE "Sprint"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("goal", '')), 'B')
  ) STORED;

CREATE INDEX "Sprint_search_vector_idx"
  ON "Sprint" USING GIN ("search_vector");

-- User (members search goes User + WorkspaceMember join;
-- vector lives on User since displayName/email are User columns).
ALTER TABLE "User"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("displayName", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("email"::text, '')), 'B')
  ) STORED;

CREATE INDEX "User_search_vector_idx"
  ON "User" USING GIN ("search_vector");
