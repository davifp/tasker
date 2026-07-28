/**
 * Event topic emitted by `AiBudgetService.reconcile()` when a workspace
 * crosses the 80% or 100% consumption threshold for the current billing
 * month. The `DomainEventsListener` in `NotificationsModule` subscribes to
 * this topic and fans out an in-app notification to workspace admins
 * (see Task 6.0). The name uses `.` delimiter to match the rest of the
 * EventEmitter2 topics in the app.
 */
export const AI_USAGE_THRESHOLD_EVENT = 'workspace-ai-usage.threshold';

export interface AiUsageThresholdEvent {
  workspaceId: string;
  billingMonth: string;
  percentage: 80 | 100;
  tokensConsumed: number;
  tokensBudget: number;
}
