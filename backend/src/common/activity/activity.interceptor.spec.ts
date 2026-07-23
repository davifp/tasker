import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityBus } from './activity.bus';
import { ActivityInterceptor } from './activity.interceptor';

describe('ActivityInterceptor', () => {
  let bus: ActivityBus;
  let interceptor: ActivityInterceptor;

  beforeEach(() => {
    bus = new ActivityBus(new EventEmitter2({ wildcard: false, delimiter: '.' }));
    interceptor = new ActivityInterceptor(bus);
    interceptor.onModuleInit();
  });

  it('increments a per-verb counter for each published event', () => {
    bus.publish({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'u-1',
      verb: 'comment.created',
      activityId: 'a-1',
    });
    bus.publish({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'u-1',
      verb: 'comment.created',
      activityId: 'a-2',
    });
    bus.publish({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: 't-1',
      actorUserId: 'u-1',
      verb: 'reaction.added',
      activityId: 'a-3',
    });

    expect(interceptor.getCounters()).toEqual({
      'comment.created': 2,
      'reaction.added': 1,
    });
  });

  it('unsubscribes on destroy so no more counters are recorded', () => {
    interceptor.onModuleDestroy();
    bus.publish({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      taskId: null,
      actorUserId: null,
      verb: 'task.created',
      activityId: 'a-1',
    });
    expect(interceptor.getCounters()).toEqual({});
  });
});
