import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // Contracts are single-sourced in the server's vendored shared (see tsconfig paths).
      { find: /^@devdigest\/shared$/, replacement: path.resolve(__dirname, '../server/src/vendor/shared/index.ts') },
      { find: /^@devdigest\/shared\//, replacement: path.resolve(__dirname, '../server/src/vendor/shared') + '/' },
      // Force one zod instance: vendored shared lives outside mcp/ and would
      // otherwise resolve server/node_modules/zod.
      { find: /^zod$/, replacement: path.resolve(__dirname, 'node_modules/zod') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
