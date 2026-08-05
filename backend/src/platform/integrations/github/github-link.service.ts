import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TaskExternalLink, TaskExternalLinkType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseIssueRef } from './provenance';

export interface CreateTaskLinkInput {
  workspaceId: string;
  taskId: string;
  externalRef: string;
  externalType: TaskExternalLinkType;
}

export interface TaskLinkSummary {
  id: string;
  taskId: string;
  provider: 'GITHUB';
  externalType: TaskExternalLinkType;
  externalRef: string;
  externalUrl: string;
  createdAt: string;
}

@Injectable()
export class GithubLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateTaskLinkInput): Promise<TaskLinkSummary> {
    const parsed = parseIssueRef(input.externalRef);
    if (!parsed) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/github-invalid-ref',
        title: 'External reference must be owner/repo#N',
        status: 400,
      });
    }
    const task = await this.prisma
      .forSystem()
      .task.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const externalUrl = this.buildUrl(parsed, input.externalType);
    const row = await this.prisma.forSystem().taskExternalLink.upsert({
      where: {
        taskId_provider_externalRef: {
          taskId: input.taskId,
          provider: 'GITHUB',
          externalRef: input.externalRef,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        provider: 'GITHUB',
        externalType: input.externalType,
        externalRef: input.externalRef,
        externalUrl,
      },
      update: { externalUrl, externalType: input.externalType },
    });
    return this.toSummary(row);
  }

  async list(workspaceId: string, taskId: string): Promise<TaskLinkSummary[]> {
    const rows = await this.prisma.forSystem().taskExternalLink.findMany({
      where: { workspaceId, taskId, provider: 'GITHUB' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async remove(workspaceId: string, taskId: string, linkId: string): Promise<void> {
    const row = await this.prisma.forSystem().taskExternalLink.findFirst({
      where: { id: linkId, workspaceId, taskId },
    });
    if (!row) {
      throw new NotFoundException('Link not found');
    }
    await this.prisma.forSystem().taskExternalLink.delete({ where: { id: linkId } });
  }

  private buildUrl(
    parsed: { owner: string; repo: string; number: number },
    type: TaskExternalLinkType,
  ): string {
    const segment = type === 'PR' ? 'pull' : 'issues';
    return `https://github.com/${parsed.owner}/${parsed.repo}/${segment}/${parsed.number}`;
  }

  private toSummary(row: TaskExternalLink): TaskLinkSummary {
    return {
      id: row.id,
      taskId: row.taskId,
      provider: 'GITHUB',
      externalType: row.externalType,
      externalRef: row.externalRef,
      externalUrl: row.externalUrl,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
