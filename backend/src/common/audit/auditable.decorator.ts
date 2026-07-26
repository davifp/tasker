import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditEventName } from './audit.events';

export const AUDITABLE_META_KEY = 'audit.auditable' as const;

export interface AuditableOptions {
  /** Canonical event name written to `AuditLog.event`. */
  event: AuditEventName;
  /**
   * Discriminator written to `AuditLog.targetType` so the audit viewer can
   * filter without decoding metadata JSON.
   */
  targetType: string;
  /**
   * Extract the `targetId` from the request/response. Runs after the handler
   * resolved. Return `undefined` to leave `targetId` null on the audit row.
   */
  targetIdFrom?: (req: Request, resBody: unknown) => string | undefined;
}

/**
 * Marks a controller handler as producing an AuditLog entry when it returns
 * a 2xx response. Consumed by `AuditMutationInterceptor`.
 */
export const Auditable = (options: AuditableOptions): MethodDecorator =>
  SetMetadata(AUDITABLE_META_KEY, options);
