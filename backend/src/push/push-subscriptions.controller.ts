import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushSubscriptionDto } from './dto/push.dto';

// Subscriptions are user-scoped (not workspace-scoped) — a browser
// registration is a per-user assertion, not per-workspace. Endpoints are
// base64url-encoded in the URL because raw endpoints contain reserved
// characters. Decoding is defensive: URIComponent-only.
@Controller('push/subscriptions')
export class PushSubscriptionsController {
  constructor(private readonly subs: PushSubscriptionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: PushSubscriptionDto,
    @Request() req: ExpressRequest & { user: JwtUser },
  ) {
    return this.subs.upsert(req.user.userId, body);
  }

  @Delete(':endpoint')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('endpoint') encoded: string,
    @Request() req: ExpressRequest & { user: JwtUser },
  ) {
    let endpoint: string;
    try {
      endpoint = decodeURIComponent(encoded);
    } catch {
      throw new NotFoundException('Subscription not found');
    }
    const result = await this.subs.deleteByEndpoint(endpoint, req.user.userId);
    if (result.deleted === 0) throw new NotFoundException('Subscription not found');
  }
}
