import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // apps/web addresses its own source as "@/", the alias its tsconfig declares.
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
      'scripts/**/*.test.ts',
      '*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/__fixtures__/**'],
    environment: 'node',
  },
});
