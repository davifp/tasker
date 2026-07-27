import { Body, Controller, Get, HttpCode, HttpStatus, Put, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { PreferencesService } from './preferences.service';
import { UpdatePreferencesBodyDto } from './dto/notifications.dto';

// Preferences are user-global by design — a user's opt-outs travel with them
// across every workspace they belong to. The controller therefore reads
// `req.user` directly rather than resolving a workspace context; the frontend
// still sends `X-Workspace-Id` so WorkspaceGuard runs and the request is
// treated as a normal authenticated call, but the service never filters by
// workspace.
@Controller('notifications/preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  async get(@Request() req: ExpressRequest & { user: JwtUser }) {
    const effective = await this.preferences.getEffective(req.user.userId);
    const items: Array<{ eventType: string; channel: string; enabled: boolean }> = [];
    for (const eventType of Object.keys(effective)) {
      for (const channel of Object.keys(effective[eventType]!)) {
        items.push({ eventType, channel, enabled: effective[eventType]![channel]! });
      }
    }
    return { items };
  }

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Body() body: UpdatePreferencesBodyDto,
    @Request() req: ExpressRequest & { user: JwtUser },
  ) {
    await this.preferences.upsertMany(req.user.userId, body.preferences);
  }
}
