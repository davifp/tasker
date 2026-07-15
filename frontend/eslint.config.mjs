import nextPlugin from '@next/eslint-plugin-next';
import { react } from '@tasker/eslint-config/react';

/** @type {import('typescript-eslint').ConfigArray} */
export default [
  ...react,
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
];
