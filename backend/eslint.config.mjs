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
    ignores: ['dist/**'],
  },
];
