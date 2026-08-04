import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { config as loadDotenv } from 'dotenv';

// Load .env before importing AppModule so ConfigModule sees the values.
loadDotenv({ path: resolve(__dirname, '../../.env') });

process.env['NODE_ENV'] ??= 'development';
// Provide safe placeholders so the ConfigModule doesn't reject a dump-only
// invocation on a machine without real secrets configured.
process.env['JWT_SECRET'] ??= '0'.repeat(32);
process.env['RT_TICKET_SECRET'] ??= '0'.repeat(32);
process.env['DATABASE_URL'] ??= 'postgres://user:pass@localhost:5432/db';
process.env['REDIS_URL'] ??= 'redis://localhost:6379';

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');
  const { buildOpenApiDocumentConfig } = await import('../src/platform/docs/openapi.setup');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();

  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
    version: string;
  };
  const config = buildOpenApiDocumentConfig({ version: pkg.version });
  const document = SwaggerModule.createDocument(app, config);

  const outputPath = resolve(__dirname, '../../openapi/baseline.json');
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `Wrote OpenAPI spec (${Object.keys(document.paths ?? {}).length} paths) to ${outputPath}`,
  );

  await app.close();
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
