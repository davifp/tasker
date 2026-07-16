import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  ArgumentsHost,
} from '@nestjs/common';
import { ZodError, z } from 'zod';
import { ProblemDetailsFilter } from './problem-details.filter';
import { TraceContext } from '../trace/trace-context';

function makeHost(url = '/test'): ArgumentsHost {
  const json = vi.fn();
  const header = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ header, json });
  const response = { status };
  const request = { url };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps ZodError to 400 with errors[]', () => {
    const schema = z.object({ name: z.string() });
    let zodError!: ZodError;
    try {
      schema.parse({ name: 123 });
    } catch (e) {
      zodError = e as ZodError;
    }

    const host = makeHost();

    TraceContext.run('trace-abc', () => {
      filter.catch(zodError, host);
    });

    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('always sets Content-Type to application/problem+json', () => {
    const host = makeHost();
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    const headerMock = vi.fn().mockReturnValue({ json: vi.fn() });
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: headerMock,
      json: vi.fn(),
    });

    TraceContext.run('trace-ct', () => {
      filter.catch(new Error('oops'), host);
    });

    expect(headerMock).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
  });

  it('maps HttpException to correct status', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const host = makeHost();
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };

    TraceContext.run('trace-http', () => {
      filter.catch(exception, host);
    });

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 for generic Error in production with no detail', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const host = makeHost();
    let capturedBody: unknown;
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: vi.fn().mockReturnValue({
        json: vi.fn((body) => {
          capturedBody = body;
        }),
      }),
      json: vi.fn(),
    });

    TraceContext.run('trace-prod', () => {
      filter.catch(new Error('secret internal error'), host);
    });

    expect(capturedBody).not.toHaveProperty('detail');
  });

  it('includes detail for generic Error in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const host = makeHost();
    let capturedBody: unknown;
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: vi.fn().mockReturnValue({
        json: vi.fn((body) => {
          capturedBody = body;
        }),
      }),
      json: vi.fn(),
    });

    TraceContext.run('trace-dev', () => {
      filter.catch(new Error('debug message'), host);
    });

    expect((capturedBody as { detail?: string })?.detail).toBe('debug message');
  });

  it('maps ServiceUnavailableException to health-degraded type URI (BUG-03 regression)', () => {
    const exception = new ServiceUnavailableException('Health check failed');
    const host = makeHost('/api/v1/health');
    let capturedBody: unknown;
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: vi.fn().mockReturnValue({
        json: vi.fn((body) => {
          capturedBody = body;
        }),
      }),
      json: vi.fn(),
    });

    TraceContext.run('trace-health', () => {
      filter.catch(exception, host);
    });

    expect((capturedBody as { type?: string })?.type).toBe(
      'https://tasker.dev/problems/health-degraded',
    );
    expect((capturedBody as { status?: number })?.status).toBe(503);
    expect((capturedBody as { traceId?: string })?.traceId).toBe('trace-health');
  });

  it('preserves custom Problem-Details type from HttpException payload', () => {
    const exception = new ForbiddenException({
      type: 'https://tasker.dev/problems/email-verification-required',
      title: 'Email Verification Required',
      detail: 'You must verify your email address before performing this action.',
      status: 403,
    });
    const host = makeHost('/api/v1/workspaces');
    let capturedBody: unknown;
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: vi.fn().mockReturnValue({
        json: vi.fn((body) => {
          capturedBody = body;
        }),
      }),
      json: vi.fn(),
    });

    TraceContext.run('trace-guard', () => {
      filter.catch(exception, host);
    });

    const body = capturedBody as {
      type?: string;
      title?: string;
      detail?: string;
      status?: number;
    };
    expect(body?.type).toBe('https://tasker.dev/problems/email-verification-required');
    expect(body?.title).toBe('Email Verification Required');
    expect(body?.detail).toBe('You must verify your email address before performing this action.');
    expect(body?.status).toBe(403);
  });

  it('always injects traceId', () => {
    const host = makeHost();
    let capturedBody: unknown;
    const res = host.switchToHttp().getResponse() as {
      status: ReturnType<typeof vi.fn>;
    };
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue({
      header: vi.fn().mockReturnValue({
        json: vi.fn((body) => {
          capturedBody = body;
        }),
      }),
      json: vi.fn(),
    });

    TraceContext.run('my-trace', () => {
      filter.catch(new HttpException('Forbidden', 403), host);
    });

    expect((capturedBody as { traceId?: string })?.traceId).toBe('my-trace');
  });
});
