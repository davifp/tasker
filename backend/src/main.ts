import 'reflect-metadata';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Load .env from workspace root (two levels up from src/)
loadDotenv({ path: path.resolve(__dirname, '../../.env') });

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  // Wire the Socket.IO Redis adapter before app.listen so the WS server is
  // ready to accept upgrades as soon as the HTTP port is bound.
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);
}

bootstrap();
