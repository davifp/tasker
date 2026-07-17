import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Label } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export interface CreateLabelInput {
  name: string;
  color: string;
  workspaceId: string;
}

export interface UpdateLabelPatch {
  name?: string;
  color?: string;
}

export interface ListLabelsOptions {
  cursor?: string;
  limit?: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateLabelInput): Promise<Label> {
    const name = input.name.trim();
    try {
      return await this.prisma.forSystem().label.create({
        data: {
          workspaceId: input.workspaceId,
          name,
          color: input.color,
        },
      });
    } catch (err) {
      if (isUniqueNameViolation(err)) {
        throw labelNameTakenError(name);
      }
      throw err;
    }
  }

  async list(workspaceId: string, opts: ListLabelsOptions = {}): Promise<CursorPage<Label>> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const items = await this.prisma.forSystem().label.findMany({
      where: { workspaceId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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

  async update(workspaceId: string, labelId: string, patch: UpdateLabelPatch): Promise<Label> {
    const normalized: Prisma.LabelUpdateInput = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };

    try {
      return await this.prisma.forSystem().label.update({
        where: { id: labelId, workspaceId },
        data: normalized,
      });
    } catch (err) {
      if (isUniqueNameViolation(err) && patch.name !== undefined) {
        throw labelNameTakenError(patch.name.trim());
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Label not found');
      }
      throw err;
    }
  }

  async delete(workspaceId: string, labelId: string): Promise<void> {
    try {
      await this.prisma.forSystem().label.delete({
        where: { id: labelId, workspaceId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Label not found');
      }
      throw err;
    }
  }
}

function isUniqueNameViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
    (err.meta as { target: string[] }).target.some((t) => t.toLowerCase().includes('name'))
  );
}

function labelNameTakenError(name: string): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/label-name-taken',
    title: 'Label name is already in use',
    detail: `A label named '${name}' already exists in this workspace.`,
    status: 409,
  });
}
