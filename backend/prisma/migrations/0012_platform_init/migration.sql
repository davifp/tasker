-- Phase 10 — Platform (Public API, Webhooks, Integrations).
--
-- Additive-only: introduces API keys, outbound webhooks (+ DLQ), first-party
-- integrations, and GitHub task↔issue bidirectional links. Every table is
-- workspace-scoped and cascades on workspace delete so existing tenancy
-- guarantees carry over unchanged.
--
-- No existing columns or indexes are altered — the search_vector GENERATED
-- columns present in the live DB (added by migration 0008_search_audit) are
-- deliberately *not* represented in schema.prisma yet (Prisma tsvector
-- limitation); leaving them out of this migration preserves the search
-- functionality that depends on them.

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM (
  'TASKS_READ',
  'TASKS_WRITE',
  'PROJECTS_READ',
  'PROJECTS_WRITE',
  'COMMENTS_READ',
  'COMMENTS_WRITE',
  'SPRINTS_READ',
  'SPRINTS_WRITE',
  'MEMBERS_READ',
  'WEBHOOKS_MANAGE'
);

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM (
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
  'SPRINT_CREATED',
  'SPRINT_UPDATED',
  'SPRINT_STARTED',
  'SPRINT_COMPLETED'
);

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'GOOGLE_CALENDAR');

-- CreateEnum
CREATE TYPE "IntegrationState" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "TaskExternalLinkType" AS ENUM ('ISSUE', 'PR');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keySalt" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyUsage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "bucketMinute" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimitedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiKeyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "secretHash" TEXT NOT NULL,
    "secretSalt" TEXT NOT NULL,
    "secretRotatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "statusCode" INTEGER,
    "responseSnippet" TEXT,
    "error" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryDLQ" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeliveryDLQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "oauthAccountId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "state" "IntegrationState" NOT NULL DEFAULT 'CONNECTED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskExternalLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalType" "TaskExternalLinkType" NOT NULL,
    "externalRef" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskExternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_revokedAt_idx" ON "ApiKey"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_createdAt_idx" ON "ApiKey"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyPrefix_last4_keyHash_key" ON "ApiKey"("keyPrefix", "last4", "keyHash");

-- CreateIndex
CREATE INDEX "ApiKeyUsage_apiKeyId_bucketMinute_idx" ON "ApiKeyUsage"("apiKeyId", "bucketMinute" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyUsage_apiKeyId_bucketMinute_key" ON "ApiKeyUsage"("apiKeyId", "bucketMinute");

-- CreateIndex
CREATE INDEX "Webhook_workspaceId_isActive_idx" ON "Webhook"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "Webhook_workspaceId_createdAt_idx" ON "Webhook"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_enqueuedAt_idx" ON "WebhookDelivery"("webhookId", "enqueuedAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_eventId_idx" ON "WebhookDelivery"("webhookId", "eventId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_enqueuedAt_idx" ON "WebhookDelivery"("enqueuedAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryDLQ_webhookId_createdAt_idx" ON "WebhookDeliveryDLQ"("webhookId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDeliveryDLQ_expiresAt_idx" ON "WebhookDeliveryDLQ"("expiresAt");

-- CreateIndex
CREATE INDEX "Integration_workspaceId_state_idx" ON "Integration"("workspaceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspaceId_provider_key" ON "Integration"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "TaskExternalLink_workspaceId_provider_idx" ON "TaskExternalLink"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "TaskExternalLink_taskId_idx" ON "TaskExternalLink"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskExternalLink_taskId_provider_externalRef_key" ON "TaskExternalLink"("taskId", "provider", "externalRef");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyUsage" ADD CONSTRAINT "ApiKeyUsage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryDLQ" ADD CONSTRAINT "WebhookDeliveryDLQ_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_oauthAccountId_fkey" FOREIGN KEY ("oauthAccountId") REFERENCES "OAuthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskExternalLink" ADD CONSTRAINT "TaskExternalLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskExternalLink" ADD CONSTRAINT "TaskExternalLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
