import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Controller, Get, Module } from '@nestjs/common';
import { z } from 'zod';
import { HttpMetricsInterceptor } from '../src/metrics/http-metrics.interceptor';
import { MetricsController } from '../src/metrics/metrics.controller';
import { MetricsRegistryService } from '../src/metrics/metrics-registry.service';
import { Public } from '../src/common/decorators/public.decorator';

// Minimal test route the interceptor gets to instrument. Marked `@Public()`
// so we don't need JwtAuthGuard wiring.
@Controller('demo')
class DemoController {
  @Get('ok')
  @Public()
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get('slow')
  @Public()
  async slow(): Promise<{ ok: true }> {
    await new Promise((r) => setTimeout(r, 15));
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (raw) => z.object({ RELEASE_ID: z.string().default('itest') }).parse(raw),
    }),
  ],
  controllers: [DemoController, MetricsController],
  providers: [
    MetricsRegistryService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
class MetricsScrapeTestModule {}

async function fetchApp(
  app: INestApplication,
  path: string,
): Promise<{ status: number; body: string }> {
  const server = app.getHttpServer() as import('http').Server;
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

describe('MetricsController + HttpMetricsInterceptor (integration)', () => {
  it('records http_request_duration_seconds + http_requests_total per route/method/status_class', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsScrapeTestModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    try {
      // 5 x ok, 2 x slow -> 7 tracked requests + 1 scrape of /metrics.
      for (let i = 0; i < 5; i++) await fetchApp(app, '/demo/ok');
      for (let i = 0; i < 2; i++) await fetchApp(app, '/demo/slow');

      const scrape = await fetchApp(app, '/metrics');
      expect(scrape.status).toBe(200);
      expect(scrape.body).toContain('# TYPE tasker_http_request_duration_seconds histogram');
      expect(scrape.body).toContain('# TYPE tasker_http_requests_total counter');

      const okCountLine = scrape.body.match(
        /tasker_http_requests_total\{route="[^"]*ok",method="GET",status_class="2xx"\} (\d+)/,
      );
      expect(okCountLine).not.toBeNull();
      expect(Number(okCountLine![1])).toBeGreaterThanOrEqual(5);

      expect(scrape.body).toMatch(
        /tasker_build_info\{release="[^"]+",service="[^"]+",node_version="[^"]+"\} 1/,
      );

      // Cardinality bound: status_class ∈ {2xx, 3xx, 4xx, 5xx}.
      const statusClasses = new Set(
        Array.from(scrape.body.matchAll(/status_class="([^"]+)"/g)).map((m) => m[1]),
      );
      for (const sc of statusClasses) {
        expect(sc).toMatch(/^\dxx$/);
      }
    } finally {
      await app.close();
    }
  });
});
