import { node } from '@tasker/eslint-config';

/** @type {import('typescript-eslint').ConfigArray} */
export default [
  ...node,
  {
    // NestJS relies on emitDecoratorMetadata for DI; `import type` strips the
    // runtime type reference that Reflect.metadata needs, so we cannot enforce
    // type-only imports here.
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Block direct PrismaClient imports outside of prisma.service.ts.
    // All database access must go through PrismaService.forTenant() to ensure
    // the tenant isolation extension is always active.
    files: ['src/**/*.ts'],
    ignores: ['src/prisma/prisma.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message:
                'Import PrismaClient only in src/prisma/prisma.service.ts. Inject PrismaService via DI and call forTenant() instead.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**'],
  },
];
