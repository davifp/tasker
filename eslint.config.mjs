import { node } from '@tasker/eslint-config';

/** @type {import('typescript-eslint').ConfigArray} */
export default [
  ...node,
  {
    // NestJS relies on emitDecoratorMetadata for DI; `import type` strips the
    // runtime type reference that Reflect.metadata needs.
    files: ['backend/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
];
