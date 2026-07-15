import { ArgumentsHost, Catch, ExceptionFilter, HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
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

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = TraceContext.get() ?? 'unknown';
    const isProduction = process.env['NODE_ENV'] === 'production';

    const body = this.buildProblemDetails(exception, request, traceId, isProduction);

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
