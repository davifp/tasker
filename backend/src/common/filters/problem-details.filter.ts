import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import { ZodValidationException } from 'nestjs-zod';
import { TraceContext } from '../trace/trace-context';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId: string;
  errors?: Array<{ path: string; message: string }>;
}

function isProblemDetailsPayload(
  value: unknown,
): value is { type: string; title?: string; detail?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = TraceContext.get() ?? 'unknown';
    const isProduction = process.env['NODE_ENV'] === 'production';

    const body = this.buildProblemDetails(exception, request, traceId, isProduction);

    // Forward 5xx (and truly-unknown exceptions) to Sentry with the request
    // trace context. The `beforeSend` filter drops 4xx before they hit the
    // network, so this call is safe for every status class.
    if (body.status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('traceId', traceId);
        const reqWithCtx = request as Request & {
          user?: { userId?: string };
          workspaceContext?: { workspaceId?: string };
        };
        const userId = reqWithCtx.user?.userId;
        const workspaceId = reqWithCtx.workspaceContext?.workspaceId;
        if (userId) scope.setUser({ id: userId });
        if (workspaceId) scope.setTag('workspaceId', workspaceId);
        scope.setContext('request', {
          method: request.method,
          url: request.originalUrl ?? request.url,
        });
        scope.setContext('response', { status_code: body.status });
        Sentry.captureException(exception);
      });
    }

    response.status(body.status).header('Content-Type', 'application/problem+json').json(body);
  }

  private buildProblemDetails(
    exception: unknown,
    request: Request,
    traceId: string,
    isProduction: boolean,
  ): ProblemDetails {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return {
        type: 'about:blank',
        title: 'Validation Error',
        status: 400,
        instance: request.url,
        traceId,
        errors: zodError.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      };
    }

    if (exception instanceof ZodError) {
      return {
        type: 'about:blank',
        title: 'Validation Error',
        status: 400,
        instance: request.url,
        traceId,
        errors: exception.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      };
    }

    if (exception instanceof ServiceUnavailableException) {
      return {
        type: 'https://tasker.dev/problems/health-degraded',
        title: 'Service Degraded',
        status: 503,
        instance: request.url,
        traceId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      // If the caller threw an HttpException with a Problem-Details-shaped
      // object (i.e. carries a custom `type` URI), preserve their fields.
      if (isProblemDetailsPayload(response)) {
        return {
          type: response.type,
          title: response.title ?? exception.message,
          status,
          instance: request.url,
          traceId,
          ...(response.detail !== undefined ? { detail: response.detail } : {}),
        };
      }

      return {
        type: 'about:blank',
        title: exception.message,
        status,
        instance: request.url,
        traceId,
      };
    }

    const detail = !isProduction && exception instanceof Error ? exception.message : undefined;

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: request.url,
      traceId,
      ...(detail ? { detail } : {}),
    };
  }
}
