-- Phase 9 — AI budget threshold notifications.
-- Extends existing Notification enums with the values Task 6.0 needs to fan
-- workspace-ai-usage.threshold events out to admins as in-app notifications.

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'AI_BUDGET_THRESHOLD';

-- AlterEnum
ALTER TYPE "NotificationSourceKind" ADD VALUE 'WORKSPACE';
