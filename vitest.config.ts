import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { NODE_TEST_FILES, VITEST_E2E_EXCLUDE, VITEST_INCLUDE } from './scripts/vitest-lanes.mjs';

export default defineConfig({
  test: {
    // Default config remains complete so release-machine focused invocations
    // can address any Vitest file. npm test uses vitest.normal.config.ts to
    // execute the exhaustive ordinary/heavy partition without contention.
    include: VITEST_INCLUDE,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...NODE_TEST_FILES,
      ...VITEST_E2E_EXCLUDE,
    ],
    environment: 'node',
    setupFiles: [resolve(__dirname, 'scripts/vitest-environment-guard.ts')],
    // Forks bound memory and native handles on Windows while allowing the
    // ordinary suites a small amount of safe file-level parallelism.
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    root: resolve(__dirname),
  },
});
