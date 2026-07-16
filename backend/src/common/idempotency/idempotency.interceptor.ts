import {
  BadRequestException,
  CallHandler,
  ConflictException,
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
const PENDING_SENTINEL = '__pending__';
// Pending lock lives long enough to outlast a reasonable request; if the
// process crashes mid-request, the lock naturally expires so retries succeed.
const PENDING_TTL_SECONDS = 60;

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

    return from(this.reserveOrRead(cacheKey)).pipe(
      switchMap((reservation) => {
        if (reservation.kind === 'cached') {
          const { status, body } = reservation.value;
          res.status(status);
          return of(body);
        }
        if (reservation.kind === 'pending') {
          // Another request with this key is in-flight. Refuse rather than
          // execute the sensitive action a second time — the client may retry.
          throw new ConflictException({
            type: 'https://tasker.dev/problems/idempotency-in-flight',
            title: 'Idempotent request already in flight',
            detail:
              'A prior request with this Idempotency-Key is still being processed. Retry shortly.',
            status: 409,
          });
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

  // Atomic single-round-trip claim: SET NX with a pending sentinel. If the
  // insert wins, we own the slot and proceed to execute the handler. If it
  // loses, we fetch the current value: either it's a completed cache entry
  // (replay) or still the pending sentinel (concurrent in-flight → 409).
  private async reserveOrRead(
    cacheKey: string,
  ): Promise<
    { kind: 'reserved' } | { kind: 'cached'; value: CachedResponse } | { kind: 'pending' }
  > {
    const inserted = await this.redis.set(
      cacheKey,
      PENDING_SENTINEL,
      'EX',
      PENDING_TTL_SECONDS,
      'NX',
    );
    if (inserted === 'OK') return { kind: 'reserved' };

    const current = await this.redis.get(cacheKey);
    if (!current || current === PENDING_SENTINEL) return { kind: 'pending' };
    return { kind: 'cached', value: JSON.parse(current) as CachedResponse };
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
