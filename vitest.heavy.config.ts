import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { HEAVY_VITEST_FILES, NODE_TEST_FILES } from './scripts/vitest-lanes.mjs';

export default defineConfig({
  test: {
    // The heavy runner supplies one file per process.  Keeping the explicit
    // include list here also makes accidental lane drift visible in review.
    include: HEAVY_VITEST_FILES,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...NODE_TEST_FILES,
    ],
    environment: 'node',
    setupFiles: [resolve(__dirname, 'scripts/vitest-environment-guard.ts')],
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    root: resolve(__dirname),
  },
});
