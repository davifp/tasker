import { describe, it, expect } from 'vitest';
import { WorkspaceContextStore, WorkspaceContext } from './workspace-context.store';

const makeCtx = (workspaceId: string): WorkspaceContext => ({
  userId: 'user-1',
  workspaceId,
  role: 'MEMBER',
  membershipId: 'mem-1',
});

describe('WorkspaceContextStore', () => {
  describe('get()', () => {
    it('returns undefined when called outside a run', () => {
      const store = new WorkspaceContextStore();
      expect(store.get()).toBeUndefined();
    });

    it('returns the active context inside a run', async () => {
      const store = new WorkspaceContextStore();
      const ctx = makeCtx('ws-1');

      await store.run(ctx, async () => {
        expect(store.get()).toEqual(ctx);
      });
    });

    it('returns undefined again after the run completes', async () => {
      const store = new WorkspaceContextStore();
      await store.run(makeCtx('ws-1'), async () => {});
      expect(store.get()).toBeUndefined();
    });
  });

  describe('require()', () => {
    it('throws when no context is set', () => {
      const store = new WorkspaceContextStore();
      expect(() => store.require()).toThrow();
    });

    it('returns the context when set', async () => {
      const store = new WorkspaceContextStore();
      const ctx = makeCtx('ws-1');

      await store.run(ctx, async () => {
        expect(store.require()).toEqual(ctx);
      });
    });
  });

  describe('run() isolation', () => {
    it('isolates concurrent runs so each sees only its own context', async () => {
      const store = new WorkspaceContextStore();
      const results: string[] = [];

      await Promise.all([
        store.run(makeCtx('ws-A'), async () => {
          // Yield to let the other run start
          await new Promise<void>(r => setTimeout(r, 5));
          results.push(store.get()!.workspaceId);
        }),
        store.run(makeCtx('ws-B'), async () => {
          results.push(store.get()!.workspaceId);
        }),
      ]);

      expect(results).toContain('ws-A');
      expect(results).toContain('ws-B');
      expect(new Set(results).size).toBe(2);
    });

    it('nested runs restore the parent context on exit', async () => {
      const store = new WorkspaceContextStore();
      const outer = makeCtx('ws-outer');
      const inner = makeCtx('ws-inner');

      await store.run(outer, async () => {
        expect(store.get()?.workspaceId).toBe('ws-outer');

        await store.run(inner, async () => {
          expect(store.get()?.workspaceId).toBe('ws-inner');
        });

        expect(store.get()?.workspaceId).toBe('ws-outer');
      });
    });
  });
});
