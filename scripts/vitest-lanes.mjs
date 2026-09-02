import fs from 'node:fs';
import path from 'node:path';

/**
 * The root Vitest invocation owns these two source trees.  The dashboard has
 * its own Vitest project and is intentionally not part of `npm test`.
 */
export const VITEST_INCLUDE = ['src/**/*.test.ts', 'scripts/**/*.test.mjs'];

/** Files that use Node's test runner and therefore are not Vitest lanes. */
export const NODE_TEST_FILES = [
  'scripts/__tests__/check-search-ranking-release-machine.test.mjs',
  'scripts/__tests__/run-lifecycle-fs-native-dispatch.test.mjs',
  'scripts/__tests__/session-run-lint.test.mjs',
  'scripts/__tests__/team-swarm-resume-prompt.test.mjs',
  'scripts/__tests__/verify-lifecycle-fs-native-workflow.test.mjs',
];

/**
 * A heavy file is intentionally run by itself in a fresh Vitest process.  Do
 * not move these back into the normal lane: several start child processes,
 * scan large trees, or exercise benchmark-sized fixtures.
 */
export const HEAVY_VITEST_FILES = [
  'scripts/__tests__/session-run-contract-parity.test.mjs',
  'src/agents/cli-agent-runner.test.ts',
  'src/commands/artifact.test.ts',
  'src/commands/knowledge.test.ts',
  'src/commands/run-machine.test.ts',
  'src/core/install-executor.test.ts',
  'src/graph/kg/__tests__/exact-external-file-scan.test.ts',
  'src/graph/kg/__tests__/search-ranking.test.ts',
  'src/hooks/__tests__/statusline-team.test.ts',
  'src/hooks/__tests__/team-monitor.test.ts',
  'src/run/runtime-topic-reuse.test.ts',
  'src/run/session-knowledge-promotion.test.ts',
  'src/run/store-durability.integration.test.ts',
  'src/run/v3/knowledge-lifecycle-v3.test.ts',
  'src/search/evaluation/pi-knowledge-absolute.test.ts',
  'src/search/evaluation/relevance-evaluator.test.ts',
  'src/tools/__tests__/knowhow-lifecycle.test.ts',
  'src/tools/__tests__/store-knowhow-lifecycle-mcp.test.ts',
  'src/tools/__tests__/store-knowhow.test.ts',
  'src/tools/__tests__/wiki-search.test.ts',
  'src/utils/__tests__/jsonl-log.test.ts',
];

const NODE_TEST_SET = new Set(NODE_TEST_FILES);
const HEAVY_TEST_SET = new Set(HEAVY_VITEST_FILES);

export function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage' || entry.name === '.git') continue;
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...walk(root, entryRelative));
    else if (entry.isFile()) files.push(normalizePath(entryRelative));
  }
  return files;
}

/** Discover exactly the files matched by the root Vitest include patterns. */
export function discoverVitestFiles(root) {
  // Limit traversal to the same trees as VITEST_INCLUDE.  Walking the whole
  // checkout would unnecessarily descend into generated/editor directories.
  return ['src', 'scripts']
    .filter((directory) => fs.existsSync(path.join(root, directory)))
    .flatMap((directory) => walk(root, directory))
    .filter((file) =>
      (file.startsWith('src/') && file.endsWith('.test.ts')) ||
      (file.startsWith('scripts/') && file.endsWith('.test.mjs')),
    )
    .sort();
}

/**
 * Verify that the explicit heavy lane and the ordinary lane partition all
 * root Vitest files, while retaining the five Node test files outside Vitest.
 */
export function assertVitestLaneParity(root) {
  const discovered = discoverVitestFiles(root);
  const discoveredSet = new Set(discovered);
  const errors = [];

  const duplicate = (values) => values.filter((value, index) => values.indexOf(value) !== index);
  const duplicateHeavy = duplicate(HEAVY_VITEST_FILES);
  if (duplicateHeavy.length > 0) errors.push(`heavy lane duplicates: ${duplicateHeavy.join(', ')}`);

  const unknownHeavy = HEAVY_VITEST_FILES.filter((file) => !discoveredSet.has(file));
  if (unknownHeavy.length > 0) errors.push(`heavy files not matched by Vitest include: ${unknownHeavy.join(', ')}`);

  const nodeMissing = NODE_TEST_FILES.filter((file) => !discoveredSet.has(file));
  if (nodeMissing.length > 0) errors.push(`Node test files not matched by Vitest include: ${nodeMissing.join(', ')}`);

  const overlap = HEAVY_VITEST_FILES.filter((file) => NODE_TEST_SET.has(file));
  if (overlap.length > 0) errors.push(`files assigned to both Node and heavy lanes: ${overlap.join(', ')}`);

  const vitestFiles = discovered.filter((file) => !NODE_TEST_SET.has(file));
  const vitestSet = new Set(vitestFiles);
  const ordinary = vitestFiles.filter((file) => !HEAVY_TEST_SET.has(file));
  const assigned = new Set([...ordinary, ...HEAVY_VITEST_FILES]);
  const omitted = vitestFiles.filter((file) => !assigned.has(file));
  if (omitted.length > 0) errors.push(`Vitest files assigned to no lane: ${omitted.join(', ')}`);

  const extra = HEAVY_VITEST_FILES.filter((file) => !vitestSet.has(file));
  if (extra.length > 0) errors.push(`heavy lane contains non-Vitest files: ${extra.join(', ')}`);

  if (ordinary.some((file) => HEAVY_TEST_SET.has(file))) {
    errors.push('ordinary and heavy lanes overlap');
  }

  if (errors.length > 0) {
    throw new Error(`Vitest lane parity check failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    total: vitestFiles.length,
    ordinary: ordinary.length,
    heavy: HEAVY_VITEST_FILES.length,
    node: NODE_TEST_FILES.length,
  };
}
