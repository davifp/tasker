import { describe, expect, it } from 'vitest';
import { buildOpenApiDocumentConfig } from './openapi.setup';

describe('buildOpenApiDocumentConfig', () => {
  it('sets title, version, and description with the platform tagline', () => {
    const config = buildOpenApiDocumentConfig({ version: '1.2.3' });

    expect(config.info.title).toBe('Tasker Public API');
    expect(config.info.version).toBe('1.2.3');
    expect(config.info.description).toContain('/api/v1');
    expect(config.info.description).toContain('Problem Details');
  });

  it('registers a bearer security scheme keyed `bearer`', () => {
    const config = buildOpenApiDocumentConfig({ version: '0.0.0' });

    const schemes = config.components?.securitySchemes ?? {};
    expect(Object.keys(schemes)).toContain('bearer');
    expect(schemes['bearer']).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('advertises platform tag namespaces so downstream routes group cleanly', () => {
    const config = buildOpenApiDocumentConfig({ version: '0.0.0' });

    const tagNames = (config.tags ?? []).map((t) => t.name);
    expect(tagNames).toEqual(
      expect.arrayContaining([
        'Auth',
        'Workspaces',
        'Projects',
        'Tasks',
        'Comments',
        'Sprints',
        'Epics',
        'Platform / API Keys',
        'Platform / Webhooks',
        'Platform / Integrations',
      ]),
    );
  });
});
