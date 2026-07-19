-- Adds nullable Task.startDate so the Timeline view can render a start/end
-- interval per task (Additional Views spec, Task 1.0). The column is
-- nullable to keep the migration backward-compatible with the existing
-- corpus, where every task previously had only `dueDate`. Application-layer
-- validation enforces `startDate <= dueDate` when both are set.
--
-- The composite (workspaceId, projectId, startDate, dueDate) index backs
-- range queries over `[from, to)` on the extended `GET /tasks` endpoint —
-- both the List/Backlog "due within window" filter and the Timeline
-- "overlaps window" filter share the same access path.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_workspaceId_projectId_startDate_dueDate_idx" ON "Task"("workspaceId", "projectId", "startDate", "dueDate");
