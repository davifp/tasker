import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Not exposed under `/api/v1` — this is an internal-only receiver so GitHub's
 * inbound calls don't share URL space with the public REST surface. Auth is
 * GitHub's `X-Hub-Signature-256` HMAC + a shared-secret env var
 * (`GITHUB_APP_WEBHOOK_SECRET`), verified before touching the payload.
 *
 * The endpoint currently persists nothing beyond logging — the comment mirror
 * loop is a follow-up. Verified signatures still return 200 so GitHub does
 * not disable the webhook.
 */
@Controller('internal/integrations/github')
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name);

  constructor(private readonly config: ConfigService) {}

  @Post('events')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleEvent(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Body() body: unknown,
    @Req() req: ExpressRequest & { rawBody?: Buffer },
  ): Promise<{ received: true; skipped?: boolean }> {
    const secret = this.config.get<string>('GITHUB_APP_WEBHOOK_SECRET', '');
    if (!secret) {
      throw new UnauthorizedException('GitHub integration webhook is not configured');
    }
    if (!signature || !signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Missing X-Hub-Signature-256 header');
    }
    // Need the raw request bytes — the JSON body Nest parsed would re-serialise
    // and drift from GitHub's HMAC. `rawBody` is populated by the
    // ProblemDetails/idempotency middleware; if it is not available, refuse.
    if (!req.rawBody) {
      throw new BadRequestException('Raw body unavailable for signature verification');
    }
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new UnauthorizedException('Invalid X-Hub-Signature-256');
    }

    this.logger.log(
      { eventType, deliveryId, hasBody: body !== undefined },
      'GitHub webhook event received and verified',
    );
    // TODO(comment-mirror): parse issue_comment / pull_request_review_comment
    // events, look up TaskExternalLink by owner/repo#N, drop echoes via
    // provenance marker, mirror new bodies into the linked Tasker task.
    return { received: true, skipped: true };
  }
}
