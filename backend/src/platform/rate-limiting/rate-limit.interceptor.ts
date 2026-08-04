import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, tap } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import type { ApiKeyRequestPrincipal } from '../api-keys/scopes.guard';
import { RateLimitMetricsCollector } from './rate-limit.metrics';
import { TokenBucketService } from './token-bucket.service';

/**
 * Runs on every request. If the caller authenticated with a JWT (no API-key
 * principal on `req.user`), the interceptor is a no-op — web UI traffic is
 * rate-limited by the existing `@nestjs/throttler` stack. If the caller used
 * an API key, the interceptor consumes a token from the per-key bucket,
 * stamps `X-RateLimit-*` headers on every response, and converts an empty
 * bucket into a Problem Details 429 with `Retry-After`.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly bucket: TokenBucketService,
    private readonly metrics: RateLimitMetricsCollector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: ApiKeyRequestPrincipal }>();
    const res = http.getResponse<Response>();

    const principal = req.user;
    if (!principal || principal.kind !== 'api-key') {
      return next.handle();
    }

    const keyPrefixForMetrics = principal.apiKeyId.slice(0, 8);

    return from(this.bucket.consume({ bucketId: principal.apiKeyId })).pipe(
      switchMap((result) => {
        setHeaders(res, result.limit, result.remaining, result.resetAtMs);

        if (!result.allowed) {
          this.metrics.incrementRateLimitHit(keyPrefixForMetrics);
          this.metrics.incrementRequest(keyPrefixForMetrics, HttpStatus.TOO_MANY_REQUESTS);
          const retryAfterS = Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000));
          res.setHeader('Retry-After', retryAfterS.toString());
          throw new HttpException(
            {
              type: 'https://tasker.dev/problems/rate-limit-exceeded',
              title: 'Rate limit exceeded',
              detail: `API key exceeded the sustained rate of ${result.limit} req/min. Retry in ${retryAfterS}s.`,
              status: HttpStatus.TOO_MANY_REQUESTS,
              retryAfterSeconds: retryAfterS,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        return next.handle().pipe(
          tap({
            next: () => {
              this.metrics.incrementRequest(keyPrefixForMetrics, res.statusCode || 200);
            },
            error: () => {
              this.metrics.incrementRequest(keyPrefixForMetrics, res.statusCode || 500);
            },
          }),
        );
      }),
    );
  }
}

function setHeaders(res: Response, limit: number, remaining: number, resetAtMs: number): void {
  // Absolute epoch seconds; matches the convention used by GitHub and Stripe.
  const resetAtS = Math.ceil(resetAtMs / 1000);
  res.setHeader('X-RateLimit-Limit', limit.toString());
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString());
  res.setHeader('X-RateLimit-Reset', resetAtS.toString());
}
