import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { HEAVY_VITEST_FILES, NODE_TEST_FILES, VITEST_INCLUDE } from './scripts/vitest-lanes.mjs';

export default defineConfig({
  test: {
    // The normal lane owns every root Vitest file except the explicit heavy
    // lane below. The lane parity check keeps this partition exhaustive.
    include: VITEST_INCLUDE,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...NODE_TEST_FILES,
      ...HEAVY_VITEST_FILES,
    ],
    environment: 'node',
    setupFiles: [resolve(__dirname, 'scripts/vitest-environment-guard.ts')],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    root: resolve(__dirname),
  },
});
