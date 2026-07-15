import reactHooks from 'eslint-plugin-react-hooks';
import { base } from './base.mjs';

/** @type {import('typescript-eslint').ConfigArray} */
export const react = [
  ...base,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
