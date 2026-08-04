import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';

const DOCS_ROUTE = 'api/v1/docs';
const OPENAPI_JSON_ROUTE = 'api/v1/openapi.json';

// Patch happens at module load so decorators registered by later imports pick
// up the Zod → OpenAPI schema converter.
patchNestJsSwagger();

export interface OpenApiSetupOptions {
  /** Package version pulled from `backend/package.json`. */
  readonly version: string;
}

export function buildOpenApiDocumentConfig(options: OpenApiSetupOptions) {
  return new DocumentBuilder()
    .setTitle('Tasker Public API')
    .setDescription(
      'Public REST API for the Tasker platform. All endpoints live under `/api/v1` ' +
        'and return Problem Details (RFC 7807) on error. Sensitive POSTs accept an ' +
        '`Idempotency-Key` header. See `/api/v1/docs` for the Swagger UI.',
    )
    .setVersion(options.version)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT or tsk_live_… API key',
        description:
          'Two authentication mechanisms accept the same header shape: (1) the ' +
          'JWT used by the web UI, or (2) an API key minted from ' +
          'Settings → Platform → API keys.',
      },
      'bearer',
    )
    .addServer('/', 'Current origin')
    .addTag('Auth', 'Registration, login, session refresh, OAuth.')
    .addTag('Workspaces', 'Workspace CRUD, members, invitations.')
    .addTag('Projects', 'Project CRUD scoped to a workspace.')
    .addTag('Tasks', 'Task CRUD, kanban ordering, dependencies, checklist.')
    .addTag('Comments', 'Task comments, mentions, reactions.')
    .addTag('Sprints', 'Sprint planning, capacity, snapshots.')
    .addTag('Epics', 'Roadmap epics.')
    .addTag('Platform / API Keys', 'API key lifecycle.')
    .addTag('Platform / Webhooks', 'Outbound webhook subscriptions and deliveries.')
    .addTag('Platform / Integrations', 'First-party integrations (GitHub, Google Calendar).')
    .build();
}

/**
 * Wire Swagger UI at `/api/v1/docs` and the raw spec at `/api/v1/openapi.json`.
 * Called from `main.ts` after `setGlobalPrefix('api/v1')` so route paths line
 * up with the rest of the API.
 */
export function setupOpenApiDocs(app: INestApplication, options: OpenApiSetupOptions): void {
  const config = buildOpenApiDocumentConfig(options);
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(DOCS_ROUTE, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_ROUTE,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
    customSiteTitle: 'Tasker API — Reference',
  });
}
