-- Reference copy of the materialized-view definitions. The authoritative
-- source is `migration.sql` in this same directory (Prisma only runs that
-- file). This companion exists so:
--   1. The admin-triggered "rebuild history" job can DROP + recreate the
--      views out of band (uses this file as the source of truth to avoid
--      re-parsing the migration).
--   2. Code review has a single, isolated diff for the SQL that drives
--      dashboard reads.
-- If you change the view definitions, edit BOTH files in the same commit.

-- mv_sprint_daily_burndown ---------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_sprint_daily_burndown" CASCADE;
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
DROP MATERIALIZED VIEW IF EXISTS "mv_workspace_cycle_lead_time" CASCADE;
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
