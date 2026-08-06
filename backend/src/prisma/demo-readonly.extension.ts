import { Prisma } from '@prisma/client';
import { WorkspaceContextStore } from '../common/context/workspace-context.store';

// Prisma-side defense-in-depth for the read-only demo account. Even if a
// mutation slips past `DemoReadOnlyGuard` (e.g. an ad-hoc script or a new
// endpoint that forgot the guard chain), the write is aborted before any row
// is touched. Applies to every write action across every model.
export const WRITE_OPS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export class DemoReadOnlyViolation extends Error {
  constructor(model: string, operation: string) {
    super(`Demo account cannot ${operation} on ${model} — this deployment is read-only.`);
    this.name = 'DemoReadOnlyViolation';
  }
}

// Pure decision helper used by the extension AND covered by the unit tests
// directly — Prisma's `defineExtension` opaque return shape is awkward to
// probe from a spec, and the interesting logic is really just this function.
export function shouldRejectAsDemo(operation: string, role: string | undefined): boolean {
  if (!WRITE_OPS.has(operation)) return false;
  return role === 'DEMO_VIEWER';
}

export function buildDemoReadOnlyExtension(store: WorkspaceContextStore) {
  return Prisma.defineExtension({
    name: 'demo-read-only',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const role = store.get()?.role;
          if (shouldRejectAsDemo(operation, role)) {
            throw new DemoReadOnlyViolation(model, operation);
          }
          return query(args);
        },
      },
    },
  });
}
