import { describe, it, expect } from 'vitest';
import { ClsServiceManager } from 'nestjs-cls';
import {
  CLS_RELEASE_ID,
  CLS_SPAN_ID,
  CLS_TRACE_ID,
  CLS_USER_ID,
  CLS_WORKSPACE_ID,
} from '../cls/cls-keys';
import { createLogMixin, LOG_REDACT_PATHS } from './log-enricher';

describe('createLogMixin', () => {
  const releaseId = 'v-test-1';
  const mixin = createLogMixin(releaseId);

  it('emits releaseId even when no CLS scope is active', () => {
    expect(mixin()).toEqual({ [CLS_RELEASE_ID]: releaseId });
  });

  it('adds every context key set inside a CLS scope', () => {
    const cls = ClsServiceManager.getClsService();
    const captured = cls.run(() => {
      cls.set(CLS_TRACE_ID, 't-1');
      cls.set(CLS_SPAN_ID, 's-1');
      cls.set(CLS_USER_ID, 'u-1');
      cls.set(CLS_WORKSPACE_ID, 'w-1');
      return mixin();
    });
    expect(captured).toEqual({
      [CLS_RELEASE_ID]: releaseId,
      [CLS_TRACE_ID]: 't-1',
      [CLS_SPAN_ID]: 's-1',
      [CLS_USER_ID]: 'u-1',
      [CLS_WORKSPACE_ID]: 'w-1',
    });
  });

  it('omits keys that are not set (rather than emitting undefined)', () => {
    const cls = ClsServiceManager.getClsService();
    const captured = cls.run(() => {
      cls.set(CLS_TRACE_ID, 't-only');
      return mixin();
    });
    expect(captured).toEqual({
      [CLS_RELEASE_ID]: releaseId,
      [CLS_TRACE_ID]: 't-only',
    });
    expect(captured).not.toHaveProperty(CLS_USER_ID);
    expect(captured).not.toHaveProperty(CLS_WORKSPACE_ID);
    expect(captured).not.toHaveProperty(CLS_SPAN_ID);
  });
});

describe('LOG_REDACT_PATHS', () => {
  it('covers the standard auth headers, tokens, and request/response bodies', () => {
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
    expect(LOG_REDACT_PATHS).toContain('req.headers.cookie');
    expect(LOG_REDACT_PATHS).toContain('req.headers["x-api-key"]');
    expect(LOG_REDACT_PATHS).toContain('req.headers["x-csrf-token"]');
    expect(LOG_REDACT_PATHS).toContain('req.body');
    expect(LOG_REDACT_PATHS).toContain('res.headers["set-cookie"]');
    expect(LOG_REDACT_PATHS).toContain('*.password');
    expect(LOG_REDACT_PATHS).toContain('*.token');
    expect(LOG_REDACT_PATHS).toContain('*.refreshToken');
    expect(LOG_REDACT_PATHS).toContain('*.apiKey');
    expect(LOG_REDACT_PATHS).toContain('*.secret');
  });
});
