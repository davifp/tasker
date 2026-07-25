-- Planning (Fase 6) — sprints, epics, snapshots, metrics telemetry.
--
-- All new tables carry `workspaceId` so PrismaTenantExtension (DMMF-driven)
-- auto-includes them in the workspace-isolation extension.
--
-- Materialized views for the dashboard live in a companion file:
-- `matviews.sql` (applied by the same migration). Each MV carries a UNIQUE
-- index because `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires one.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "SprintState" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SprintSnapshotPhase" AS ENUM ('START', 'COMPLETE');

-- CreateEnum
CREATE TYPE "EpicStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "MetricJobStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

-- ---------------------------------------------------------------------------
-- Task — new planning columns (nullable so existing rows are unaffected).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Task"
  ADD COLUMN "estimate" INTEGER,
  ADD COLUMN "sprintId" TEXT,
  ADD COLUMN "epicId"   TEXT;

-- ---------------------------------------------------------------------------
-- Sprint
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "Sprint" (
    "id"              TEXT           NOT NULL,
    "workspaceId"     TEXT           NOT NULL,
    "projectId"       TEXT           NOT NULL,
    "number"          INTEGER        NOT NULL,
    "name"            TEXT           NOT NULL,
    "goal"            TEXT,
    "state"           "SprintState"  NOT NULL DEFAULT 'PLANNED',
    "startDate"       TIMESTAMP(3)   NOT NULL,
    "endDate"         TIMESTAMP(3)   NOT NULL,
    "startedAt"       TIMESTAMP(3),
    "completedAt"     TIMESTAMP(3),
    "createdByUserId" TEXT           NOT NULL,
    "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)   NOT NULL,
    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- SprintCapacity
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "SprintCapacity" (
    "id"             TEXT          NOT NULL,
    "workspaceId"    TEXT          NOT NULL,
    "sprintId"       TEXT          NOT NULL,
    "memberUserId"   TEXT          NOT NULL,
    "capacityPoints" INTEGER       NOT NULL,
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "SprintCapacity_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- SprintTaskSnapshot
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "SprintTaskSnapshot" (
    "id"             TEXT                  NOT NULL,
    "workspaceId"    TEXT                  NOT NULL,
    "sprintId"       TEXT                  NOT NULL,
    "taskId"         TEXT                  NOT NULL,
    "phase"          "SprintSnapshotPhase" NOT NULL,
    "snapshotAt"     TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"         "TaskStatus"          NOT NULL,
    "estimate"       INTEGER,
    "assigneeUserId" TEXT,
    CONSTRAINT "SprintTaskSnapshot_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Epic
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "Epic" (
    "id"              TEXT           NOT NULL,
    "workspaceId"     TEXT           NOT NULL,
    "projectId"       TEXT           NOT NULL,
    "title"           TEXT           NOT NULL,
    "description"     TEXT,
    "status"          "EpicStatus"   NOT NULL DEFAULT 'PLANNED',
    "startQuarter"    TEXT           NOT NULL,
    "endQuarter"      TEXT           NOT NULL,
    "createdByUserId" TEXT           NOT NULL,
    "deletedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)   NOT NULL,
    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- MetricJobLog
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "MetricJobLog" (
    "id"          TEXT               NOT NULL,
    "workspaceId" TEXT,
    "matview"     TEXT               NOT NULL,
    "status"      "MetricJobStatus"  NOT NULL,
    "startedAt"   TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"  TIMESTAMP(3),
    "refreshMs"   INTEGER,
    "error"       TEXT,
    CONSTRAINT "MetricJobLog_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Task planning indexes.
CREATE INDEX "Task_sprintId_idx"         ON "Task"("sprintId");
CREATE INDEX "Task_sprintId_status_idx"  ON "Task"("sprintId", "status");
CREATE INDEX "Task_epicId_idx"           ON "Task"("epicId");

-- Sprint.
CREATE UNIQUE INDEX "Sprint_projectId_number_key" ON "Sprint"("projectId", "number");
CREATE INDEX "Sprint_workspaceId_state_idx"                 ON "Sprint"("workspaceId", "state");
CREATE INDEX "Sprint_workspaceId_projectId_startDate_idx"   ON "Sprint"("workspaceId", "projectId", "startDate");

-- PRD FR-2: at most one Active sprint per project. Enforced at the DB layer
-- via a partial unique index (Prisma cannot express this in @@unique).
CREATE UNIQUE INDEX "Sprint_projectId_active_key"
  ON "Sprint"("projectId") WHERE "state" = 'ACTIVE';

-- SprintCapacity.
CREATE UNIQUE INDEX "SprintCapacity_sprintId_memberUserId_key"
  ON "SprintCapacity"("sprintId", "memberUserId");
CREATE INDEX "SprintCapacity_workspaceId_idx" ON "SprintCapacity"("workspaceId");

-- SprintTaskSnapshot — immutable audit trail; the composite unique enforces
-- one row per (sprint, task, phase) so `captureOnStart` and `captureOnComplete`
-- are safely idempotent.
CREATE UNIQUE INDEX "SprintTaskSnapshot_sprintId_taskId_phase_key"
  ON "SprintTaskSnapshot"("sprintId", "taskId", "phase");
CREATE INDEX "SprintTaskSnapshot_sprintId_phase_snapshotAt_idx"
  ON "SprintTaskSnapshot"("sprintId", "phase", "snapshotAt");
CREATE INDEX "SprintTaskSnapshot_workspaceId_idx" ON "SprintTaskSnapshot"("workspaceId");

-- Epic.
CREATE INDEX "Epic_workspaceId_startQuarter_endQuarter_idx"
  ON "Epic"("workspaceId", "startQuarter", "endQuarter");
CREATE INDEX "Epic_workspaceId_projectId_status_idx"
  ON "Epic"("workspaceId", "projectId", "status");

-- MetricJobLog — descending finishedAt for "latest successful refresh" reads.
CREATE INDEX "MetricJobLog_workspaceId_matview_finishedAt_idx"
  ON "MetricJobLog"("workspaceId", "matview", "finishedAt" DESC);
CREATE INDEX "MetricJobLog_matview_startedAt_idx"
  ON "MetricJobLog"("matview", "startedAt" DESC);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

-- Task planning FKs. SetNull so unlinking (via sprint removal or epic delete)
-- does not cascade-delete tasks.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_sprintId_fkey"
  FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_epicId_fkey"
  FOREIGN KEY ("epicId") REFERENCES "Epic"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Sprint FKs.
ALTER TABLE "Sprint"
  ADD CONSTRAINT "Sprint_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sprint"
  ADD CONSTRAINT "Sprint_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sprint"
  ADD CONSTRAINT "Sprint_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SprintCapacity FKs.
ALTER TABLE "SprintCapacity"
  ADD CONSTRAINT "SprintCapacity_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SprintCapacity"
  ADD CONSTRAINT "SprintCapacity_sprintId_fkey"
  FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SprintCapacity"
  ADD CONSTRAINT "SprintCapacity_memberUserId_fkey"
  FOREIGN KEY ("memberUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SprintTaskSnapshot FKs.
ALTER TABLE "SprintTaskSnapshot"
  ADD CONSTRAINT "SprintTaskSnapshot_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SprintTaskSnapshot"
  ADD CONSTRAINT "SprintTaskSnapshot_sprintId_fkey"
  FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SprintTaskSnapshot"
  ADD CONSTRAINT "SprintTaskSnapshot_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Epic FKs.
ALTER TABLE "Epic"
  ADD CONSTRAINT "Epic_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Epic"
  ADD CONSTRAINT "Epic_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Epic"
  ADD CONSTRAINT "Epic_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- MetricJobLog FKs — workspaceId is nullable (global refresh runs); SetNull
-- so hard-deleting a workspace does not blow away the job log tail.
ALTER TABLE "MetricJobLog"
  ADD CONSTRAINT "MetricJobLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Materialized views
-- ---------------------------------------------------------------------------
-- Both views carry a UNIQUE index so `REFRESH MATERIALIZED VIEW CONCURRENTLY`
-- succeeds. A parallel copy lives in `matviews.sql` for reference and for the
-- rebuild-history admin job that DROPs and recreates them out of band.

-- mv_sprint_daily_burndown ---------------------------------------------------
-- Grain: (workspaceId, sprintId, day). `plannedPoints` is the START-phase
-- snapshot total (nulls contribute 0 to the sum but still count for scope).
-- `completedPoints` is the running total of DONE snapshot rows aggregated by
-- day; `remainingPoints` = plannedPoints - completedPoints for each day.
CREATE MATERIALIZED VIEW "mv_sprint_daily_burndown" AS
WITH sprint_days AS (
    SELECT
        s."workspaceId",
        s."id"          AS "sprintId",
        gs::date        AS "day"
    FROM "Sprint" s
    CROSS JOIN LATERAL generate_series(
        date_trunc('day', s."startDate"),
        date_trunc('day', s."endDate"),
        interval '1 day'
    ) AS gs
),
planned AS (
    SELECT
        "sprintId",
        COALESCE(SUM("estimate"), 0)::int AS "plannedPoints"
    FROM "SprintTaskSnapshot"
    WHERE "phase" = 'START'
    GROUP BY "sprintId"
),
completed AS (
    -- Progress derived from the closing snapshot only. Live activity events
    -- feed the on-demand refresh (see MetricsRefreshProcessor); the base
    -- snapshot ensures reproducibility after a completed sprint is edited.
    SELECT
        "sprintId",
        date_trunc('day', "snapshotAt")::date AS "day",
        COALESCE(SUM("estimate") FILTER (WHERE "status" = 'DONE'), 0)::int AS "completedPoints"
    FROM "SprintTaskSnapshot"
    WHERE "phase" = 'COMPLETE'
    GROUP BY "sprintId", date_trunc('day', "snapshotAt")::date
)
SELECT
    sd."workspaceId",
    sd."sprintId",
    sd."day",
    COALESCE(p."plannedPoints", 0)                                              AS "plannedPoints",
    COALESCE(c."completedPoints", 0)                                            AS "completedPoints",
    (COALESCE(p."plannedPoints", 0) - COALESCE(c."completedPoints", 0))         AS "remainingPoints"
FROM sprint_days sd
LEFT JOIN planned   p ON p."sprintId" = sd."sprintId"
LEFT JOIN completed c ON c."sprintId" = sd."sprintId" AND c."day" = sd."day";

CREATE UNIQUE INDEX "mv_sprint_daily_burndown_pk"
  ON "mv_sprint_daily_burndown"("workspaceId", "sprintId", "day");
CREATE INDEX "mv_sprint_daily_burndown_sprintId_idx"
  ON "mv_sprint_daily_burndown"("sprintId", "day");

-- mv_workspace_cycle_lead_time ----------------------------------------------
-- Grain: (workspaceId, projectId, taskId, doneAt). Business-hours math is
-- computed by the application layer (CycleLeadTimeMath) and re-populated on
-- refresh; the view starts empty and the processor UPSERTs derived rows so
-- the pure-SQL definition does not need to reach for timezone-heavy logic.
-- Kept as a table-backed view (SELECT from an empty projection with matching
-- column types) so `REFRESH … CONCURRENTLY` can rebuild it after the worker
-- writes fresh derived data.
CREATE MATERIALIZED VIEW "mv_workspace_cycle_lead_time" AS
SELECT
    t."workspaceId",
    t."projectId",
    t."id"                                     AS "taskId",
    t."updatedAt"                              AS "doneAt",
    0::numeric                                 AS "leadTimeBusinessHours",
    0::numeric                                 AS "cycleTimeBusinessHours",
    date_trunc('week', t."updatedAt")::date    AS "bucketWeek"
FROM "Task" t
WHERE t."status" = 'DONE' AND t."deletedAt" IS NULL;

CREATE UNIQUE INDEX "mv_workspace_cycle_lead_time_pk"
  ON "mv_workspace_cycle_lead_time"("workspaceId", "taskId", "doneAt");
CREATE INDEX "mv_workspace_cycle_lead_time_bucket_idx"
  ON "mv_workspace_cycle_lead_time"("workspaceId", "bucketWeek");
