-- Partial unique index guarding the fractional-indexing position key per column.
--
-- Scope is (projectId, status) so each Kanban column owns its own dense
-- ordering. Fractional-indexing keys are dense within a column but can
-- freely repeat across columns of the same project (e.g. both BACKLOG and
-- TODO can have an "a0" head). Constraint applies only to live
-- (non-soft-deleted) tasks so soft-deleted rows keep their old positions
-- without blocking new inserts at the same key. Mirrors the pattern used
-- by Invitation_workspaceId_email_unresolved_key
-- (see 0001_auth_workspaces/migration.sql:129).
--
-- Techspec §Key decisions — Atomic move endpoint: concurrent movers can
-- compute the same fractional-index midpoint from the same neighbor
-- snapshot; the constraint surfaces the collision so the service can
-- regenerate from a fresh tail and retry once.
CREATE UNIQUE INDEX "Task_projectId_status_position_live_key"
    ON "Task"("projectId", "status", "position")
    WHERE "deletedAt" IS NULL;
