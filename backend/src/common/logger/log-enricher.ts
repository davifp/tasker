import { ClsServiceManager } from 'nestjs-cls';
import {
  CLS_RELEASE_ID,
  CLS_SPAN_ID,
  CLS_TRACE_ID,
  CLS_USER_ID,
  CLS_WORKSPACE_ID,
  type ClsLogContext,
} from '../cls/cls-keys';

// Reads the ambient CLS store — Pino invokes this on every log write and the
// call happens outside of the Nest DI container, so we resolve the singleton
// via ClsServiceManager rather than constructor injection.
export function createLogMixin(releaseId: string): () => ClsLogContext {
  return () => {
    const cls = ClsServiceManager.getClsService();
    const context: ClsLogContext = { [CLS_RELEASE_ID]: releaseId };
    if (!cls.isActive()) return context;
    const traceId = cls.get<string | undefined>(CLS_TRACE_ID);
    if (traceId) context[CLS_TRACE_ID] = traceId;
    const spanId = cls.get<string | undefined>(CLS_SPAN_ID);
    if (spanId) context[CLS_SPAN_ID] = spanId;
    const userId = cls.get<string | undefined>(CLS_USER_ID);
    if (userId) context[CLS_USER_ID] = userId;
    const workspaceId = cls.get<string | undefined>(CLS_WORKSPACE_ID);
    if (workspaceId) context[CLS_WORKSPACE_ID] = workspaceId;
    return context;
  };
}

// Pino redact paths. Any key here (case-sensitive) is replaced with '[REDACTED]'
// wherever it appears at the log-object root or inside `req` / `res` / `body`.
// The list covers auth headers, secrets, tokens, and the request/response body
// itself (never log user-authored content — audit events use structured fields).
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'req.body',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
  '*.masterKey',
  '*.authorization',
];
