import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { readTelemetryConfig, startTelemetry, shutdownTelemetry } from './telemetry';
import { startSentry } from './sentry/sentry.init';

// Side-effect module. Import at the very top of main.ts *before* any @nestjs/*
// or database/redis/socket.io import — the Node SDK patches those modules on
// require, so we must be running by the time they load.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};

const config = readTelemetryConfig(process.env, pkg.version);
startTelemetry(config);

// Sentry init sits alongside OTel — reads its own DSN and shares the release
// identifier so errors and traces link back to the same deployed build.
startSentry({
  dsn: process.env['SENTRY_DSN'] ?? '',
  environment: process.env['SENTRY_ENVIRONMENT'] ?? config.environment,
  release: config.releaseId,
  tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE']
    ? Math.min(1, Math.max(0, Number(process.env['SENTRY_TRACES_SAMPLE_RATE'])))
    : 0.1,
  service: process.env['OTEL_SERVICE_NAME'] ?? 'tasker-api',
});

const shutdown = async (): Promise<void> => {
  try {
    await shutdownTelemetry();
  } catch {
    // Exporter shutdown can throw on abrupt exits; nothing we can do.
  }
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
