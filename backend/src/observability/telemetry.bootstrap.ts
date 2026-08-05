import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { readTelemetryConfig, startTelemetry, shutdownTelemetry } from './telemetry';

// Side-effect module. Import at the very top of main.ts *before* any @nestjs/*
// or database/redis/socket.io import — the Node SDK patches those modules on
// require, so we must be running by the time they load.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};

const config = readTelemetryConfig(process.env, pkg.version);
startTelemetry(config);

const shutdown = async (): Promise<void> => {
  try {
    await shutdownTelemetry();
  } catch {
    // Exporter shutdown can throw on abrupt exits; nothing we can do.
  }
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
