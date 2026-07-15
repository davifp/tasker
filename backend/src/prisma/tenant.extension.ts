import { Prisma } from '@prisma/client';
import { WorkspaceContextStore } from '../common/context/workspace-context.store';

// Derived at module load from the DMMF — any model that carries a `workspaceId`
// field is automatically covered. Adding a new tenant-aware model to the schema
// requires no change here.
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter(m => m.fields.some(f => f.name === 'workspaceId'))
    .map(m => m.name),
);

// Operations whose top-level args carry a `where` clause.
const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/**
 * Mutates the args object in place to inject workspaceId.
 * Our value is placed last in the spread so it always wins over any
 * user-supplied workspaceId (prevents tenant spoofing).
 *
 * Exported for unit testing without a live Prisma client.
 */
export function applyTenantContext(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  workspaceId: string,
): void {
  if (!TENANT_MODELS.has(model)) return;

  if (WHERE_OPS.has(operation)) {
    args['where'] = { ...(args['where'] as Record<string, unknown> | undefined), workspaceId };
  }

  if (operation === 'create' && args['data'] !== undefined) {
    args['data'] = { ...(args['data'] as Record<string, unknown>), workspaceId };
  }

  if (operation === 'createMany' && Array.isArray(args['data'])) {
    args['data'] = (args['data'] as Record<string, unknown>[]).map(item => ({
      ...item,
      workspaceId,
    }));
  }

  if (operation === 'upsert' && args['create'] !== undefined) {
    args['create'] = { ...(args['create'] as Record<string, unknown>), workspaceId };
  }
}

export function buildTenantExtension(store: WorkspaceContextStore) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }
          const { workspaceId } = store.require();
          applyTenantContext(model, operation, args as Record<string, unknown>, workspaceId);
          return query(args);
        },
      },
    },
  });
}
