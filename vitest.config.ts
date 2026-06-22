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
      'src/tools/__tests__/team-tasks-mcp.test.ts',
      'src/tools/__tests__/team-msg.test.ts',
      'src/tools/__tests__/team-mailbox.test.ts',
      'src/tools/__tests__/team-agents.test.ts',
      'src/tools/__tests__/team-e2e.test.ts',
      'src/tools/__tests__/team-integration.test.ts',
      'src/tools/__tests__/spec-writer.test.ts',
      'src/tools/__tests__/spec-writer-ref.test.ts',
      'src/tools/__tests__/spec-writer-size-guard.test.ts',
      'src/tools/__tests__/spec-loader-ref.test.ts',
      'src/tools/__tests__/spec-keyword-index.test.ts',
      'src/tools/__tests__/spec-cli-e2e.test.ts',
      'src/tools/__tests__/domain-schema.test.ts',
      'src/tools/__tests__/domain-matcher.test.ts',
      'src/tools/__tests__/domain-loader.test.ts',
      'src/tools/__tests__/domain-search-debug.ts',
      'src/graph/kg/__tests__/scan-scope.test.ts',
      'src/graph/kg/__tests__/wasm-runtime-flags.test.ts',
      'src/graph/kg/__tests__/code-extractor-streaming.test.ts',
      'src/graph/kg/__tests__/orchestrator.test.ts',
      'src/graph/kg/__tests__/search-benchmark.test.ts',
      'src/hooks/__tests__/spec-bridge.test.ts',
      'src/hooks/__tests__/keyword-spec-injector.test.ts',
      'src/hooks/__tests__/wiki-role-loader.test.ts',
      'src/hooks/__tests__/spec-injector-vitest.test.ts',
      'src/hooks/__tests__/kg-hooks.test.ts',
      'src/team/__tests__/team-phase-integration.test.ts',
      'src/graph/__tests__/graph-enhanced.test.ts',
    ],
    environment: 'node',
    root: resolve(__dirname),
  },
});
