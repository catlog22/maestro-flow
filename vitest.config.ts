import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // P0 test-infra unification: all test files migrated node:test → vitest.
    // vitest resolves `.js`→`.ts` imports (node --test does not), so the
    // previously-"red" files (MODULE_NOT_FOUND) turn green here.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    root: resolve(__dirname),
  },
});
