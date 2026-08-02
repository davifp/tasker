import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PushSubscriptionInput } from './dto/push.dto';

@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Upsert by endpoint so a browser re-registering the same subscription
  // does not fail on the unique constraint. `lastSeenAt` bumps on every
  // upsert so the dormant sweep only reaps truly abandoned rows.
  async upsert(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<{ id: string; endpoint: string }> {
    const now = new Date();
    const row = await this.prisma.forSystem().pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        authKey: input.keys.auth,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        lastSeenAt: now,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        authKey: input.keys.auth,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        lastSeenAt: now,
      },
      select: { id: true, endpoint: true },
    });
    return row;
  }

  async listForUser(userId: string) {
    return this.prisma.forSystem().pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, authKey: true, lastSeenAt: true },
    });
  }

  // Called by both the user-driven DELETE and by `PushChannel` when the
  // provider responds 404/410. `deleteMany` avoids a Prisma error when the
  // row has already been reaped concurrently.
  async deleteByEndpoint(endpoint: string, userId?: string): Promise<{ deleted: number }> {
    const result = await this.prisma.forSystem().pushSubscription.deleteMany({
      where: {
        endpoint,
        ...(userId ? { userId } : {}),
      },
    });
    return { deleted: result.count };
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.prisma.forSystem().pushSubscription.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }
}
