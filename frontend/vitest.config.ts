import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws in any non-server import path — swap for a no-op
      // so modules that import it can be exercised from vitest.
      'server-only': new URL('./test/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: [
        'dist/**',
        '.next/**',
        'eslint.config.mjs',
        'next.config.ts',
        'next-env.d.ts',
        'postcss.config.js',
        'tailwind.config.ts',
        'vitest.config.ts',
        'vitest.setup.ts',
      ],
    },
  },
});
