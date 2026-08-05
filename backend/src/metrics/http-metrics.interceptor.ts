import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Counter, Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';
import { MetricsRegistryService } from './metrics-registry.service';

// Cardinality-safe route extraction. Falls back to the raw path only when
// Express has resolved a matched route entry — otherwise we substitute a
// generic label so unmatched 404s don't create one bucket per URL variant.
function extractRouteLabel(req: Request): string {
  const routePath = (req as unknown as { route?: { path?: string } }).route?.path;
  if (routePath) return routePath;
  const originalUrl = req.originalUrl?.split('?', 1)[0];
  return originalUrl && /^\/api\/v1\/(health|metrics)/.test(originalUrl)
    ? originalUrl
    : 'unmatched';
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly duration: Histogram<'route' | 'method' | 'status_class'>;
  private readonly requests: Counter<'route' | 'method' | 'status_class'>;

  constructor(registry: MetricsRegistryService) {
    this.duration = registry.histogram({
      name: 'tasker_http_request_duration_seconds',
      help: 'Inbound HTTP request duration (seconds), labelled by route, method, and status class.',
      labelNames: ['route', 'method', 'status_class'] as const,
      // Web-request oriented buckets: catches the P50/P95/P99 latency modes
      // typical for an API without wasting resolution on multi-second outliers.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });
    this.requests = registry.counter({
      name: 'tasker_http_requests_total',
      help: 'Inbound HTTP requests counted by route, method, and status class.',
      labelNames: ['route', 'method', 'status_class'] as const,
    });
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();
    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, start),
        error: () => this.record(req, res, start),
      }),
    );
  }

  private record(req: Request, res: Response, start: bigint): void {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const status = res.statusCode || 0;
    const labels = {
      route: extractRouteLabel(req),
      method: req.method,
      status_class: `${Math.floor(status / 100)}xx`,
    };
    this.duration.observe(labels, durationSec);
    this.requests.inc(labels);
  }
}
