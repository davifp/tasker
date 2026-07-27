import { browserHttp } from './browser';
import type { CursorPage } from './types';

export type NotificationEventType =
  'COMMENT_MENTION' | 'TASK_ASSIGNED' | 'COMMENT_FOLLOWED' | 'SPRINT_LIFECYCLE';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';

export type NotificationSourceKind = 'TASK' | 'COMMENT' | 'SPRINT';

export interface NotificationItem {
  id: string;
  workspaceId: string;
  recipientUserId: string;
  actorUserId: string | null;
  eventType: NotificationEventType;
  sourceKind: NotificationSourceKind;
  sourceId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCount {
  count: number;
}

export interface PreferenceEntry {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface PreferencesResponse {
  items: PreferenceEntry[];
}

export interface UpdatePreferencesInput {
  preferences: PreferenceEntry[];
}

export interface ListNotificationsOptions {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationEventType;
}

function toQuery(opts: ListNotificationsOptions): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (opts.unreadOnly) params.set('unreadOnly', 'true');
  if (opts.type) params.set('type', opts.type);
  return params.size > 0 ? `?${params.toString()}` : '';
}

export const notificationsHttp = {
  list(opts: ListNotificationsOptions = {}) {
    return browserHttp.get<CursorPage<NotificationItem>>(`/notifications${toQuery(opts)}`);
  },
  unreadCount() {
    return browserHttp.get<UnreadCount>('/notifications/unread-count');
  },
  markRead(id: string) {
    return browserHttp.patch<void>(`/notifications/${id}/read`);
  },
  markAllRead() {
    return browserHttp.post<{ updated: number }>('/notifications/read-all');
  },
  getPreferences() {
    return browserHttp.get<PreferencesResponse>('/notifications/preferences');
  },
  updatePreferences(input: UpdatePreferencesInput) {
    return browserHttp.put<void>('/notifications/preferences', input);
  },
};
