import { describe, it, expect } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import { extractInboundTraceId } from './trace-header';

describe('extractInboundTraceId', () => {
  it('extracts the 32-hex trace-id segment from a W3C traceparent', () => {
    const headers: IncomingHttpHeaders = {
      traceparent: '00-1234567890abcdef1234567890abcdef-fedcba0987654321-01',
    };
    expect(extractInboundTraceId(headers)).toBe('1234567890abcdef1234567890abcdef');
  });

  it('accepts uppercase hex per the W3C spec', () => {
    const headers: IncomingHttpHeaders = {
      traceparent: '00-ABCDEF1234567890ABCDEF1234567890-FEDCBA0987654321-01',
    };
    expect(extractInboundTraceId(headers)).toBe('ABCDEF1234567890ABCDEF1234567890');
  });

  it('falls back to x-trace-id when traceparent is absent', () => {
    expect(extractInboundTraceId({ 'x-trace-id': 'legacy-abc' })).toBe('legacy-abc');
  });

  it('prefers traceparent over x-trace-id when both are present', () => {
    const headers: IncomingHttpHeaders = {
      traceparent: '00-1234567890abcdef1234567890abcdef-fedcba0987654321-01',
      'x-trace-id': 'legacy-should-lose',
    };
    expect(extractInboundTraceId(headers)).toBe('1234567890abcdef1234567890abcdef');
  });

  it('returns undefined when traceparent is malformed and no legacy header is present', () => {
    expect(extractInboundTraceId({ traceparent: 'not-valid' })).toBeUndefined();
    expect(
      extractInboundTraceId({ traceparent: '00-tooshort-fedcba0987654321-01' }),
    ).toBeUndefined();
  });

  it('returns undefined for empty x-trace-id (no header at all)', () => {
    expect(extractInboundTraceId({ 'x-trace-id': '' })).toBeUndefined();
    expect(extractInboundTraceId({})).toBeUndefined();
  });

  it('ignores array-valued x-trace-id (Node passes duplicated headers as arrays)', () => {
    expect(extractInboundTraceId({ 'x-trace-id': ['a', 'b'] })).toBeUndefined();
  });
});
