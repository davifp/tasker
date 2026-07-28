-- Phase 9 — AI Actions
-- Adds:
--   * three enums (AiAction, AiInvocationStatus, AiFeedbackRating)
--   * WorkspaceAiConsent — one row per workspace, admin opt-in with a
--                          documentVersion so consent can be reset on policy
--                          updates.
--   * WorkspaceAiUsage   — monthly rolling budget per workspace, atomically
--                          incremented via Prisma's `increment` operator.
--                          `notifiedAt80` / `notifiedAt100` are set at most
--                          once per month so threshold notifications
--                          (@OnEvent workspace-ai-usage.threshold) fire once
--                          per boundary.
--   * AiInvocation       — one row per LLM call, regardless of outcome.
--                          `cachedInputTokens` tracks Anthropic prompt-cache
--                          hits separately from billable input tokens.
--   * AiFeedback         — 👍/👎 attached to a specific invocation; unique on
--                          `(invocationId, createdByUserId)` so a user can
--                          rate an invocation at most once.
-- All new tables are workspace-scoped and indexed by
-- `(workspaceId, createdAt DESC)` for the audit-style reads described in the
-- tech spec.
-- Additive migration: no existing table shape changes; the four new
-- back-relations added to `Workspace` and `User` in `schema.prisma` are
-- resolved at the Prisma client layer and require no SQL.

-- CreateEnum
CREATE TYPE "AiAction" AS ENUM ('GENERATE_DESCRIPTION', 'SUMMARIZE_COMMENTS', 'GENERATE_CHECKLIST', 'ESTIMATE_AND_SUGGEST');

-- CreateEnum
CREATE TYPE "AiInvocationStatus" AS ENUM ('OK', 'ERROR', 'ABORTED');

-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateTable
CREATE TABLE "WorkspaceAiConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "acceptedByUserId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAiUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "tokensBudget" INTEGER NOT NULL,
    "tokensReserved" INTEGER NOT NULL DEFAULT 0,
    "tokensConsumed" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt80" TIMESTAMP(3),
    "notifiedAt100" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInvocation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "AiAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" "AiInvocationStatus" NOT NULL,
    "errorCode" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "rating" "AiFeedbackRating" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiConsent_workspaceId_key" ON "WorkspaceAiConsent"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiUsage_workspaceId_billingMonth_key" ON "WorkspaceAiUsage"("workspaceId", "billingMonth");

-- CreateIndex
CREATE INDEX "WorkspaceAiUsage_workspaceId_createdAt_idx" ON "WorkspaceAiUsage"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiInvocation_workspaceId_createdAt_idx" ON "AiInvocation"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiInvocation_workspaceId_action_createdAt_idx" ON "AiInvocation"("workspaceId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiInvocation_workspaceId_actorUserId_createdAt_idx" ON "AiInvocation"("workspaceId", "actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AiFeedback_invocationId_createdByUserId_key" ON "AiFeedback"("invocationId", "createdByUserId");

-- CreateIndex
CREATE INDEX "AiFeedback_workspaceId_createdAt_idx" ON "AiFeedback"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiFeedback_invocationId_idx" ON "AiFeedback"("invocationId");

-- AddForeignKey
ALTER TABLE "WorkspaceAiConsent" ADD CONSTRAINT "WorkspaceAiConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAiConsent" ADD CONSTRAINT "WorkspaceAiConsent_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAiUsage" ADD CONSTRAINT "WorkspaceAiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInvocation" ADD CONSTRAINT "AiInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInvocation" ADD CONSTRAINT "AiInvocation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "AiInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
