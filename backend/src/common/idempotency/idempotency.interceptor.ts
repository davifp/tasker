import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { IDEMPOTENT_KEY } from './idempotency.decorators';

interface CachedResponse {
  status: number;
  body: unknown;
}

const KEY_MAX_LEN = 200;
const TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isIdempotent) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const rawKey = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!rawKey) return next.handle(); // Header is optional; behave normally if absent.

    if (rawKey.length > KEY_MAX_LEN) {
      throw new BadRequestException(`Idempotency-Key must be at most ${KEY_MAX_LEN} characters`);
    }

    const cacheKey = this.buildKey(http, req, rawKey);

    return from(this.redis.get(cacheKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          const { status, body } = JSON.parse(cached) as CachedResponse;
          res.status(status);
          return of(body);
        }
        return next.handle().pipe(
          tap((body) => {
            const payload: CachedResponse = { status: res.statusCode, body };
            void this.redis.set(cacheKey, JSON.stringify(payload), 'EX', TTL_SECONDS);
          }),
        );
      }),
    );
  }

  // Scope the idempotency key by user + route so two different callers using
  // the same Idempotency-Key can't collide.
  private buildKey(_http: HttpArgumentsHost, req: Request, rawKey: string): string {
    const user = (req as unknown as { user?: { userId?: string } }).user;
    const userScope = user?.userId ?? 'anon';
    const method = req.method;
    const path = req.route?.path ?? req.path;
    return `idem:${userScope}:${method}:${path}:${rawKey}`;
  }
}
