import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { ListLabelsQueryDto } from './dto/list-labels-query.dto';
import { LabelsService } from './labels.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Post()
  @Roles('ADMIN')
  async create(
    @Body() dto: CreateLabelDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.labels.create({
      name: dto.name,
      color: dto.color,
      workspaceId: ctx.workspaceId,
    });
  }

  @Get()
  async list(
    @Query() query: ListLabelsQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.labels.list(ctx.workspaceId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Patch(':id')
  @Roles('ADMIN')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLabelDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.labels.update(ctx.workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.labels.delete(ctx.workspaceId, id);
  }
}
