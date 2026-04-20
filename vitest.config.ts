import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Only include vitest-compatible test files.
    // Many test files use `node:test` (Node.js built-in runner) instead of vitest
    // and must be excluded to avoid "No test suite found" errors.
    include: [
      'src/config/**/*.test.ts',
      'src/core/**/*.test.ts',
      'src/hooks/__tests__/preflight-*.test.ts',
      'src/tools/__tests__/collab-adapter*.test.ts',
      'src/tools/__tests__/merge-validator.test.ts',
      'src/tools/__tests__/namespace-guard.test.ts',
      'src/tools/__tests__/team-tasks.test.ts',
    ],
    environment: 'node',
    root: resolve(__dirname),
  },
});
