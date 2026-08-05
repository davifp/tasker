import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Load .env from workspace root (two levels up from src/)
loadDotenv({ path: path.resolve(__dirname, '../../.env') });

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupOpenApiDocs } from './platform/docs/openapi.setup';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as {
  version: string;
};

async function bootstrap(): Promise<void> {
  // `rawBody: true` stashes the exact request bytes on `req.rawBody` for
  // signature-verifying webhook receivers (e.g. GitHub's X-Hub-Signature-256).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
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
