-- Persists per-(user, project) durable view preferences for the Additional
-- Views feature (Phase 4). The `prefs` payload is validated by Zod on write
-- so the JSON column has no schema-level constraints — unknown keys are
-- stripped before they land here, and reasonable size caps are applied at
-- the DTO layer.
--
-- Keyed by the composite (userId, projectId) so a user has at most one row
-- per project. The (projectId) secondary index backs bulk cleanup jobs
-- (e.g. purge a project's preferences on project delete) — the composite
-- PK already covers point lookups on `(userId, projectId)`.
--
-- Cascade on both FKs mirrors how sibling tables (Task, ChecklistItem,
-- Comment) already handle User + Project deletion — orphan rows can't
-- outlive their user or project.

-- CreateTable
CREATE TABLE "UserProjectViewPreference" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prefs" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProjectViewPreference_pkey" PRIMARY KEY ("userId", "projectId")
);

-- CreateIndex
CREATE INDEX "UserProjectViewPreference_projectId_idx" ON "UserProjectViewPreference"("projectId");

-- AddForeignKey
ALTER TABLE "UserProjectViewPreference" ADD CONSTRAINT "UserProjectViewPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectViewPreference" ADD CONSTRAINT "UserProjectViewPreference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
