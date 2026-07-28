import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiMetricsCollector } from '../metrics/ai.metrics';
import type { SubmitFeedbackInput } from '../dto';

/**
 * Persists 👍/👎 against an `AiInvocation` and bumps the
 * `tasker_ai_feedback_total{action,rating}` counter. Enforces one rating per
 * user per invocation via the `(invocationId, createdByUserId)` unique index;
 * a duplicate surfaces as 409 Problem Details so the client can render "you
 * already rated this response" without a full round trip through the
 * generic 500 handler.
 */
@Injectable()
export class AiFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: AiMetricsCollector,
  ) {}

  async submit(
    workspaceId: string,
    userId: string,
    input: SubmitFeedbackInput,
  ): Promise<{ id: string }> {
    const invocation = await this.prisma.forSystem().aiInvocation.findFirst({
      where: { id: input.invocationId, workspaceId },
      select: { id: true, action: true },
    });
    if (!invocation) {
      throw new HttpException(
        {
          type: 'about:blank#ai-invocation-not-found',
          title: 'AI invocation not found',
          detail: 'No AI invocation with the given id exists in this workspace.',
          status: 404,
        },
        404,
      );
    }

    try {
      const created = await this.prisma.forSystem().aiFeedback.create({
        data: {
          workspaceId,
          invocationId: invocation.id,
          createdByUserId: userId,
          rating: input.rating,
          reason: input.reason ?? null,
        },
        select: { id: true },
      });
      this.metrics.incrementFeedback(invocation.action, input.rating);
      return created;
    } catch (err) {
      // Unique constraint on (invocationId, createdByUserId).
      if (isUniqueViolation(err)) {
        throw new HttpException(
          {
            type: 'about:blank#ai-feedback-duplicate',
            title: 'Feedback already submitted',
            detail: 'You have already rated this AI response.',
            status: 409,
          },
          409,
        );
      }
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
