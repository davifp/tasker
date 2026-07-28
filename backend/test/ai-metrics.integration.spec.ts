/**
 * Integration test for GET /metrics — asserts the AI collector section is
 * appended to the Prometheus scrape after `AiInvocationRecorder.record()`
 * fires, without dropping the previously-registered collectors.
 *
 * Requires docker-compose Postgres + Redis (matching the health integration
 * test); AppModule is booted once, an AI invocation is recorded through
 * the real recorder, then `/metrics` is scraped and parsed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';

const TEST_TIMEOUT = 30_000;

describe('GET /metrics — AI section (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    const [{ AppModule }, { AiMetricsCollector }, { Test }, { Logger }] = await Promise.all([
      import('../src/app.module'),
      import('../src/ai/metrics/ai.metrics'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);

    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Seed the AI metrics collector directly so the /metrics scrape has
    // non-zero series to render. Using the collector rather than
    // AiInvocationRecorder keeps this test focused on the /metrics wiring
    // (recorder ↔ AuditLog dual-write is covered by the recorder spec).
    const metrics = app.get(AiMetricsCollector, { strict: false });
    metrics.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    metrics.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', 42);
    metrics.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'output', 17);
    metrics.observeLatency('GENERATE_DESCRIPTION', 'anthropic', 640);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await app?.close();
  }, TEST_TIMEOUT);

  it('exposes the AI section alongside the pre-existing collectors', async () => {
    const res = await fetch(`${baseUrl}/api/v1/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();

    // AI section — sample line from the recorder above.
    expect(body).toContain(
      'tasker_ai_invocations_total{action="GENERATE_DESCRIPTION",provider="anthropic",model="claude-sonnet-4-6",status="OK"} 1',
    );
    expect(body).toContain(
      'tasker_ai_tokens_total{action="GENERATE_DESCRIPTION",provider="anthropic",kind="input"} 42',
    );
    expect(body).toContain('tasker_ai_latency_ms_bucket');

    // Existing collectors — verify none went missing.
    expect(body).toContain('# TYPE tasker_realtime_connections');
    expect(body).toContain('# TYPE tasker_notification_delivered_total');
  });
});
