// MUST be first: bootstraps the OpenTelemetry SDK so it can patch @nestjs/*,
// pg, ioredis, socket.io, and undici on require. Also loads .env.
import './observability/telemetry.bootstrap';
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { hostname } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupOpenApiDocs } from './platform/docs/openapi.setup';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as {
  version: string;
};

// Resolved once at boot so every log line and every observability signal
// (metrics `build_info`, Sentry `release`, OTel resource) shares the same id.
const releaseId = process.env['RELEASE_ID'] || `dev-${hostname()}`;

async function bootstrap(): Promise<void> {
  // `rawBody: true` stashes the exact request bytes on `req.rawBody` for
  // signature-verifying webhook receivers (e.g. GitHub's X-Hub-Signature-256).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  logger.log(
    { releaseId, version: pkg.version, nodeVersion: process.version },
    'API bootstrap starting',
  );
  app.setGlobalPrefix('api/v1');
  setupOpenApiDocs(app, { version: pkg.version });
  // Wire the Socket.IO Redis adapter before app.listen so the WS server is
  // ready to accept upgrades as soon as the HTTP port is bound.
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);
}

bootstrap();
