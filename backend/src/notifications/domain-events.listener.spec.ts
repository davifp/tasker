import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeEmitter } from '../realtime/realtime.emitter';
import type { NotificationsService } from './notifications.service';
import { DomainEventsListener } from './domain-events.listener';

function makeListener(prismaOverrides?: {
  task?: unknown;
  comment?: Array<{ body: string; authorUserId: string }> | null;
  mentions?: Array<{ mentionedUserId: string }>;
  followers?: Array<{ authorUserId: string }>;
  sprint?: unknown;
  sprintTasks?: Array<{ assigneeUserId: string | null }>;
  capacities?: Array<{ memberUserId: string }>;
  displayName?: string;
  project?: { name: string } | null;
  admins?: Array<{ userId: string }>;
}) {
  const emit = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  const emitter = { emit } as unknown as RealtimeEmitter;
  const notifications = { notify } as unknown as NotificationsService;
  const prisma = {
    forSystem: () => ({
      task: {
        findUnique: vi.fn().mockResolvedValue(
          prismaOverrides?.task ?? {
            title: 'Ship it',
            number: 42,
            project: { slug: 'web', name: 'Web' },
          },
        ),
        findMany: vi.fn().mockResolvedValue(prismaOverrides?.sprintTasks ?? []),
      },
      comment: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            prismaOverrides?.comment !== undefined
              ? prismaOverrides.comment
              : { body: 'Hi @ana', authorUserId: 'actor-1' },
          ),
        findMany: vi.fn().mockResolvedValue(prismaOverrides?.followers ?? []),
      },
      commentMention: {
        findMany: vi.fn().mockResolvedValue(prismaOverrides?.mentions ?? []),
      },
      sprint: {
        findUnique: vi
          .fn()
          .mockResolvedValue(prismaOverrides?.sprint ?? { name: 'S1', projectId: 'p-1' }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue(prismaOverrides?.project ?? { name: 'Web' }),
      },
      sprintCapacity: {
        findMany: vi.fn().mockResolvedValue(prismaOverrides?.capacities ?? []),
      },
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ displayName: prismaOverrides?.displayName ?? 'Ana' }),
      },
      workspaceMember: {
        findMany: vi.fn().mockResolvedValue(prismaOverrides?.admins ?? []),
      },
    }),
  } as unknown as PrismaService;
  return { listener: new DomainEventsListener(emitter, notifications, prisma), emit, notify };
}

beforeEach(() => vi.clearAllMocks());

describe('DomainEventsListener.onTaskCreated', () => {
  it('emits task.updated and notifies the initial assignee (when not the actor)', async () => {
    const { listener, emit, notify } = makeListener();
    await listener.onTaskCreated({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      number: 42,
      actorUserId: 'actor-1',
      assigneeUserId: 'user-b',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.updated', taskId: 't-1' }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TASK_ASSIGNED', recipients: ['user-b'] }),
    );
  });

  it('does not notify when the assignee equals the actor', async () => {
    const { listener, notify } = makeListener();
    await listener.onTaskCreated({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      number: 42,
      actorUserId: 'actor-1',
      assigneeUserId: 'actor-1',
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('DomainEventsListener.onTaskUpdated (assignee delta)', () => {
  it('notifies only the newly-assigned user when the delta is present', async () => {
    const { listener, notify } = makeListener();
    await listener.onTaskUpdated({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'actor-1',
      assigneeDelta: { previousUserId: null, currentUserId: 'user-b' },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TASK_ASSIGNED', recipients: ['user-b'] }),
    );
  });

  it('does not notify on unassignment (current === null)', async () => {
    const { listener, notify } = makeListener();
    await listener.onTaskUpdated({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'actor-1',
      assigneeDelta: { previousUserId: 'user-b', currentUserId: null },
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('is silent when no delta accompanies the event', async () => {
    const { listener, notify } = makeListener();
    await listener.onTaskUpdated({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'actor-1',
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('DomainEventsListener.onCommentAdded', () => {
  it('emits comment.created + notifies mentions and followers separately', async () => {
    const { listener, emit, notify } = makeListener({
      mentions: [{ mentionedUserId: 'ana' }],
      followers: [{ authorUserId: 'bruno' }, { authorUserId: 'actor-1' }],
    });
    await listener.onCommentAdded({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      commentId: 'c-1',
      actorUserId: 'actor-1',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'comment.created', commentId: 'c-1' }),
    );
    // Two separate notify calls: mention + followed.
    const calls = notify.mock.calls.map((c) => c[0].eventType);
    expect(calls).toContain('COMMENT_MENTION');
    expect(calls).toContain('COMMENT_FOLLOWED');
    // Follower set excludes both the actor and the mentioned users.
    const followedCall = notify.mock.calls.find((c) => c[0].eventType === 'COMMENT_FOLLOWED')?.[0];
    expect(followedCall?.recipients).toEqual(['bruno']);
  });

  it('is a no-op when there are no mentions and no other followers', async () => {
    const { listener, notify } = makeListener({
      mentions: [],
      followers: [{ authorUserId: 'actor-1' }],
    });
    await listener.onCommentAdded({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      commentId: 'c-1',
      actorUserId: 'actor-1',
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('DomainEventsListener sprint lifecycle', () => {
  it('emits sprint.updated and notifies task assignees + capacity members', async () => {
    const { listener, emit, notify } = makeListener({
      sprintTasks: [{ assigneeUserId: 'ana' }, { assigneeUserId: 'bruno' }],
      capacities: [{ memberUserId: 'clara' }],
    });
    await listener.onSprintStarted({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      sprintId: 's-1',
      actorUserId: 'actor-1',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sprint.updated', state: 'ACTIVE' }),
    );
    const call = notify.mock.calls[0]![0];
    expect(call.eventType).toBe('SPRINT_LIFECYCLE');
    expect(call.recipients.sort()).toEqual(['ana', 'bruno', 'clara']);
  });

  it('is silent when the sprint has no recipients', async () => {
    const { listener, emit, notify } = makeListener({
      sprintTasks: [],
      capacities: [],
    });
    await listener.onSprintCompleted({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      sprintId: 's-1',
      actorUserId: 'actor-1',
    });
    expect(emit).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('DomainEventsListener.onAiUsageThreshold', () => {
  it('notifies only workspace admins with the threshold payload', async () => {
    const { listener, notify } = makeListener({
      admins: [{ userId: 'admin-1' }, { userId: 'owner-1' }],
    });
    await listener.onAiUsageThreshold({
      workspaceId: 'ws-1',
      billingMonth: '2026-07',
      percentage: 80,
      tokensConsumed: 810,
      tokensBudget: 1000,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        eventType: 'AI_BUDGET_THRESHOLD',
        recipients: ['admin-1', 'owner-1'],
        sourceEntity: { kind: 'WORKSPACE', id: 'ws-1:2026-07:80' },
        payload: {
          percentage: 80,
          tokensConsumed: 810,
          tokensBudget: 1000,
          billingMonth: '2026-07',
        },
      }),
    );
  });

  it('is a no-op when the workspace has no admins', async () => {
    const { listener, notify } = makeListener({ admins: [] });
    await listener.onAiUsageThreshold({
      workspaceId: 'ws-1',
      billingMonth: '2026-07',
      percentage: 100,
      tokensConsumed: 1050,
      tokensBudget: 1000,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('gives distinct sourceEntity.id per (workspace, month, threshold) so dedupe does not collapse 80 & 100', async () => {
    const { listener, notify } = makeListener({
      admins: [{ userId: 'admin-1' }],
    });
    await listener.onAiUsageThreshold({
      workspaceId: 'ws-1',
      billingMonth: '2026-07',
      percentage: 80,
      tokensConsumed: 810,
      tokensBudget: 1000,
    });
    await listener.onAiUsageThreshold({
      workspaceId: 'ws-1',
      billingMonth: '2026-07',
      percentage: 100,
      tokensConsumed: 1010,
      tokensBudget: 1000,
    });
    expect(notify).toHaveBeenCalledTimes(2);
    const first = (notify as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      sourceEntity: { id: string };
    };
    const second = (notify as unknown as { mock: { calls: unknown[][] } }).mock.calls[1][0] as {
      sourceEntity: { id: string };
    };
    expect(first.sourceEntity.id).toBe('ws-1:2026-07:80');
    expect(second.sourceEntity.id).toBe('ws-1:2026-07:100');
  });
});
