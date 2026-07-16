import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  membershipId: string;
}

@Injectable()
export class WorkspaceContextStore {
  private readonly storage = new AsyncLocalStorage<WorkspaceContext>();

  run<T>(ctx: WorkspaceContext, fn: () => T): T {
    return this.storage.run(ctx, fn);
  }

  get(): WorkspaceContext | undefined {
    return this.storage.getStore();
  }

  require(): WorkspaceContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error('No workspace context set — call WorkspaceContextStore.run() first');
    }
    return ctx;
  }
}
