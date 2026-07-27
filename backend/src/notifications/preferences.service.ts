import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PreferenceEntry } from './dto/notifications.dto';

// Default preference matrix per PRD:
//   * COMMENT_MENTION + TASK_ASSIGNED  → on for every channel
//   * COMMENT_FOLLOWED                 → on for IN_APP only
//   * SPRINT_LIFECYCLE                 → on for IN_APP + EMAIL
// Kept as a pure lookup so callers can consult defaults without hitting the DB
// (used by the fan-out gate for rows the user has never touched).
const DEFAULTS: Record<NotificationEventType, Record<NotificationChannel, boolean>> = {
  COMMENT_MENTION: { IN_APP: true, EMAIL: true, PUSH: true },
  TASK_ASSIGNED: { IN_APP: true, EMAIL: true, PUSH: true },
  COMMENT_FOLLOWED: { IN_APP: true, EMAIL: false, PUSH: false },
  SPRINT_LIFECYCLE: { IN_APP: true, EMAIL: true, PUSH: false },
};

export function defaultPreference(
  eventType: NotificationEventType,
  channel: NotificationChannel,
): boolean {
  return DEFAULTS[eventType][channel];
}

export interface EffectivePreferenceMap {
  [K: string]: { [C: string]: boolean };
}

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  // Merges DB rows over defaults. Missing rows fall through to DEFAULTS so a
  // user who has never opened the preferences page still gets sensible
  // routing. Returned as a plain object indexed by `[eventType][channel]`.
  async getEffective(userId: string): Promise<EffectivePreferenceMap> {
    const rows = await this.prisma
      .forSystem()
      .notificationPreference.findMany({ where: { userId } });
    const result: EffectivePreferenceMap = {};
    for (const eventType of Object.keys(DEFAULTS) as NotificationEventType[]) {
      result[eventType] = { ...DEFAULTS[eventType] };
    }
    for (const row of rows) {
      const bucket = result[row.eventType];
      if (bucket) bucket[row.channel] = row.enabled;
    }
    return result;
  }

  // Convenience for the fan-out gate — one lookup per (event × channel).
  async isEnabled(
    userId: string,
    eventType: NotificationEventType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const row = await this.prisma.forSystem().notificationPreference.findUnique({
      where: { userId_eventType_channel: { userId, eventType, channel } },
    });
    return row ? row.enabled : defaultPreference(eventType, channel);
  }

  // The preferences page submits the full matrix; we upsert every entry in a
  // single transaction so partial failure never leaves the matrix in a mixed
  // state.
  async upsertMany(userId: string, entries: PreferenceEntry[]): Promise<void> {
    await this.prisma.forSystem().$transaction(
      entries.map((entry) =>
        this.prisma.forSystem().notificationPreference.upsert({
          where: {
            userId_eventType_channel: {
              userId,
              eventType: entry.eventType,
              channel: entry.channel,
            },
          },
          create: {
            userId,
            eventType: entry.eventType,
            channel: entry.channel,
            enabled: entry.enabled,
          },
          update: { enabled: entry.enabled },
        }),
      ),
    );
  }

  // Read all defaults so the preferences page can render every row even for a
  // user with zero saved preferences.
  listAll(): Array<{
    eventType: NotificationEventType;
    channel: NotificationChannel;
    enabled: boolean;
  }> {
    const out: Array<{
      eventType: NotificationEventType;
      channel: NotificationChannel;
      enabled: boolean;
    }> = [];
    for (const eventType of Object.keys(DEFAULTS) as NotificationEventType[]) {
      const bucket = DEFAULTS[eventType];
      for (const channel of Object.keys(bucket) as NotificationChannel[]) {
        out.push({ eventType, channel, enabled: bucket[channel] });
      }
    }
    return out;
  }
}
