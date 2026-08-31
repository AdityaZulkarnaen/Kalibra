import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', '*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/__fixtures__/**'],
    environment: 'node',
  },
});
