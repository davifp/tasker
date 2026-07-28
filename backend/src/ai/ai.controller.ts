import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { AiBudgetService } from './budget/ai-budget.service';
import { AiConsentGuard } from './budget/ai-consent.guard';
import { SkipAiConsent } from './budget/ai-consent.decorator';
import { AiConsentService } from './budget/ai-consent.service';
import {
  AcceptConsentInputSchema,
  SubmitFeedbackInputSchema,
  type AcceptConsentInput,
  type SubmitFeedbackInput,
} from './dto';
import { AiFeedbackService } from './feedback/ai-feedback.service';
import { EstimateAndSuggestService } from './use-cases/estimate-and-suggest.service';
import { GenerateChecklistService } from './use-cases/generate-checklist.service';
import { GenerateDescriptionService } from './use-cases/generate-description.service';
import { SummarizeCommentsService } from './use-cases/summarize-comments.service';

const acceptConsentPipe = new ZodValidationPipe(AcceptConsentInputSchema);
const submitFeedbackPipe = new ZodValidationPipe(SubmitFeedbackInputSchema);

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

function abortSignalFrom(req: ExpressRequest, res: ExpressResponse): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('close', abort);
  res.on('close', abort);
  return controller.signal;
}

function beginSseHeaders(res: ExpressResponse): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disables nginx proxy buffering when the reverse proxy is present.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function writeSseEvent(res: ExpressResponse, event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

function writeSseError(res: ExpressResponse, err: unknown): void {
  const problem =
    err instanceof HttpException
      ? { ...(err.getResponse() as object), status: err.getStatus() }
      : {
          type: 'about:blank#ai-provider-unavailable',
          title: 'AI provider unavailable',
          detail: err instanceof Error ? err.message : 'Unknown error',
          status: 503,
        };
  writeSseEvent(res, 'error', problem);
}

/**
 * HTTP surface for Phase 9 AI actions. All routes are workspace-scoped and
 * traverse the guardrail chain declared in `AppModule`:
 *
 *   JwtAuthGuard → WorkspaceGuard → RolesGuard → AiConsentGuard → ThrottlerGuard(aiAction)
 *
 * Streaming endpoints return Server-Sent Events:
 *
 *   event: message\ndata: <text chunk>\n\n     ← one per delta
 *   event: done\ndata: {}\n\n                  ← terminal success frame
 *   event: error\ndata: <ProblemDetails>\n\n   ← terminal failure frame
 *
 * Non-streaming endpoints return JSON. All failures surface as RFC 7807
 * Problem Details (either on the response body directly for JSON routes, or
 * inside the SSE `error` frame for streaming ones).
 */
@Controller('workspaces/:slug/ai')
@UseGuards(AiConsentGuard)
@Throttle({ aiAction: {} })
export class AiController {
  constructor(
    private readonly budget: AiBudgetService,
    private readonly consent: AiConsentService,
    private readonly feedback: AiFeedbackService,
    private readonly generateDescription: GenerateDescriptionService,
    private readonly summarize: SummarizeCommentsService,
    private readonly generateChecklist: GenerateChecklistService,
    private readonly estimate: EstimateAndSuggestService,
  ) {}

  // -------------------------------------------------------------------------
  // Consent (admin only) — `Idempotency-Key` supported so a UI double-click
  // during the onboarding modal doesn't produce two audit lines.
  // -------------------------------------------------------------------------

  @Post('consent')
  @Roles('ADMIN')
  @SkipAiConsent()
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptConsent(
    @Req() req: ExpressRequest,
    @Body(acceptConsentPipe) body: AcceptConsentInput,
  ): Promise<void> {
    const ctx = requireCtx(req);
    await this.consent.accept(ctx.workspaceId, ctx.userId, body.documentVersion);
  }

  // -------------------------------------------------------------------------
  // Usage snapshot (admin only) — usable even before consent so admins can
  // preview the budget number in the settings screen.
  // -------------------------------------------------------------------------

  @Get('usage')
  @Roles('ADMIN')
  @SkipAiConsent()
  async getUsage(@Req() req: ExpressRequest) {
    const ctx = requireCtx(req);
    const [usage, status] = await Promise.all([
      this.budget.getCurrentUsage(ctx.workspaceId),
      this.consent.getStatus(ctx.workspaceId),
    ]);
    return { ...usage, consent: status };
  }

  // -------------------------------------------------------------------------
  // Feedback — any member can rate their own AI response.
  // -------------------------------------------------------------------------

  @Post('feedback')
  @Roles('MEMBER')
  @SkipAiConsent()
  async submitFeedback(
    @Req() req: ExpressRequest,
    @Body(submitFeedbackPipe) body: SubmitFeedbackInput,
  ) {
    const ctx = requireCtx(req);
    return this.feedback.submit(ctx.workspaceId, ctx.userId, body);
  }

  // -------------------------------------------------------------------------
  // Use-cases
  // -------------------------------------------------------------------------

  @Post('tasks/:taskId/generate-description')
  @Roles('MEMBER')
  async streamGenerateDescription(
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
    @Param('taskId') taskId: string,
    @Body()
    body: { title?: string; projectName?: string; labels?: string[]; relatedTaskTitles?: string[] },
  ): Promise<void> {
    const ctx = requireCtx(req);
    const title = body?.title?.trim();
    if (!title || title.length < 3) {
      throw new BadRequestException({
        type: 'about:blank#ai-insufficient-context',
        title: 'Title is required to generate a description',
        detail: 'Provide a task title of at least 3 characters.',
        status: 400,
      });
    }
    beginSseHeaders(res);
    try {
      const stream = this.generateDescription.execute({
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        taskId,
        title,
        projectName: body?.projectName,
        labels: body?.labels,
        relatedTaskTitles: body?.relatedTaskTitles,
        signal: abortSignalFrom(req, res),
      });
      for await (const chunk of stream) {
        if (chunk.delta) writeSseEvent(res, 'message', chunk.delta);
      }
      writeSseEvent(res, 'done', {});
    } catch (err) {
      writeSseError(res, err);
    } finally {
      res.end();
    }
  }

  @Post('tasks/:taskId/comments/summarize')
  @Roles('MEMBER')
  async streamSummarizeComments(
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
    @Param('taskId') taskId: string,
  ): Promise<void> {
    const ctx = requireCtx(req);
    beginSseHeaders(res);
    try {
      const stream = this.summarize.execute({
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        taskId,
        signal: abortSignalFrom(req, res),
      });
      for await (const chunk of stream) {
        if (chunk.delta) writeSseEvent(res, 'message', chunk.delta);
      }
      writeSseEvent(res, 'done', {});
    } catch (err) {
      writeSseError(res, err);
    } finally {
      res.end();
    }
  }

  @Post('tasks/:taskId/generate-checklist')
  @Roles('MEMBER')
  async streamGenerateChecklist(
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
    @Param('taskId') taskId: string,
  ): Promise<void> {
    const ctx = requireCtx(req);
    beginSseHeaders(res);
    try {
      const { invocationId, result } = await this.generateChecklist.execute({
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        taskId,
        signal: abortSignalFrom(req, res),
      });
      writeSseEvent(res, 'result', { invocationId, ...result });
      writeSseEvent(res, 'done', {});
    } catch (err) {
      writeSseError(res, err);
    } finally {
      res.end();
    }
  }

  @Post('tasks/:taskId/estimate-and-suggest')
  @Roles('MEMBER')
  async postEstimateAndSuggest(@Req() req: ExpressRequest, @Param('taskId') taskId: string) {
    const ctx = requireCtx(req);
    return this.estimate.execute({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      taskId,
    });
  }
}
