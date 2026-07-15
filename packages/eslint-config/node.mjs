import { base } from './base.mjs';

/** @type {import('typescript-eslint').ConfigArray} */
export const node = [
  ...base,
  {
    rules: {
      'no-console': 'warn',
      'prefer-const': 'error',
    },
  },
];
