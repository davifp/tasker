import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Project, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProjectCreatedEvent,
  ProjectDeletedEvent,
  ProjectEvents,
  ProjectRestoredEvent,
  ProjectUpdatedEvent,
} from './events/project.events';
import { updateProjectPatchSchema } from './dto/update-project.dto';

const SLUG_RETRY_LIMIT = 3;
const SOFT_DELETE_WINDOW_DAYS = 30;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export interface CreateProjectInput {
  name: string;
  slug: string;
  color: string;
  icon: string;
  description?: string;
  workspaceId: string;
  actorUserId: string;
}

export interface UpdateProjectPatch {
  name?: string;
  color?: string;
  icon?: string;
  description?: string | null;
  status?: ProjectStatus;
}

export interface ListProjectsOptions {
  cursor?: string;
  limit?: number;
  status?: ProjectStatus;
  includeDeleted?: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const client = this.prisma.forSystem();

    for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
      const candidate = attempt === 0 ? input.slug : `${input.slug}-${attempt + 1}`;
      try {
        const project = await client.project.create({
          data: {
            workspaceId: input.workspaceId,
            slug: candidate,
            name: input.name,
            color: input.color,
            icon: input.icon,
            description: input.description ?? null,
            ownerUserId: input.actorUserId,
            createdByUserId: input.actorUserId,
          },
        });

        this.events.emit(ProjectEvents.CREATED, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorUserId: input.actorUserId,
          slug: project.slug,
        } satisfies ProjectCreatedEvent);

        return project;
      } catch (err) {
        if (isUniqueSlugViolation(err)) continue;
        throw err;
      }
    }

    throw new ConflictException({
      type: 'https://tasker.dev/problems/project-slug-taken',
      title: 'Project slug is already in use',
      detail: `The slug '${input.slug}' and its numeric suffixes are all taken in this workspace.`,
      status: 409,
    });
  }

  async findBySlug(
    workspaceId: string,
    slug: string,
    includeDeleted = false,
  ): Promise<Project | null> {
    const project = await this.prisma.forSystem().project.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } },
    });
    if (!project) return null;
    if (project.deletedAt && !includeDeleted) return null;
    return project;
  }

  async update(
    workspaceId: string,
    projectId: string,
    patch: UpdateProjectPatch,
    actorUserId: string,
  ): Promise<Project> {
    // Defense-in-depth (BUG-02.M1): controllers already run this through
    // ValidationPipe, but the service is reachable from workers, other
    // modules, and tests — none of which route through Nest. A second
    // Zod parse here surfaces the same actionable 400-shape error the
    // HTTP path would produce, instead of a downstream Prisma failure.
    const parsed = updateProjectPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/invalid-project-patch',
        title: 'Invalid project update',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        status: 400,
      });
    }
    const safePatch = parsed.data;

    const project = await this.prisma.forSystem().project.update({
      where: { id: projectId, workspaceId },
      data: {
        ...(safePatch.name !== undefined ? { name: safePatch.name } : {}),
        ...(safePatch.color !== undefined ? { color: safePatch.color } : {}),
        ...(safePatch.icon !== undefined ? { icon: safePatch.icon } : {}),
        ...(safePatch.description !== undefined ? { description: safePatch.description } : {}),
        ...(safePatch.status !== undefined ? { status: safePatch.status } : {}),
      },
    });

    this.events.emit(ProjectEvents.UPDATED, {
      workspaceId,
      projectId: project.id,
      actorUserId,
    } satisfies ProjectUpdatedEvent);

    return project;
  }

  async softDelete(params: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<Project> {
    const now = new Date();
    const purgeAt = new Date(now.getTime() + SOFT_DELETE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const project = await this.prisma.forSystem().project.update({
      where: { id: params.projectId, workspaceId: params.workspaceId },
      data: { deletedAt: now, purgeAt },
    });

    this.events.emit(ProjectEvents.DELETED, {
      workspaceId: params.workspaceId,
      projectId: project.id,
      actorUserId: params.actorUserId,
      purgeAt,
    } satisfies ProjectDeletedEvent);

    return project;
  }

  async restore(params: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<Project> {
    const existing = await this.prisma.forSystem().project.findUnique({
      where: { id: params.projectId, workspaceId: params.workspaceId },
    });
    if (!existing) throw new NotFoundException('Project not found');
    if (!existing.deletedAt) throw new BadRequestException('Project is not deleted');
    if (existing.purgeAt && existing.purgeAt < new Date()) {
      throw new BadRequestException('Project has already been purged');
    }

    const project = await this.prisma.forSystem().project.update({
      where: { id: params.projectId, workspaceId: params.workspaceId },
      data: { deletedAt: null, purgeAt: null },
    });

    this.events.emit(ProjectEvents.RESTORED, {
      workspaceId: params.workspaceId,
      projectId: project.id,
      actorUserId: params.actorUserId,
    } satisfies ProjectRestoredEvent);

    return project;
  }

  async list(workspaceId: string, opts: ListProjectsOptions = {}): Promise<CursorPage<Project>> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const where: Prisma.ProjectWhereInput = {
      workspaceId,
      ...(opts.includeDeleted ? {} : { deletedAt: null }),
      ...(opts.status ? { status: opts.status } : {}),
    };

    const items = await this.prisma.forSystem().project.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }
}

function isUniqueSlugViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
    (err.meta as { target: string[] }).target.some((t) => t.toLowerCase().includes('slug'))
  );
}
