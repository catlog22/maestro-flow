#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVitestLaneParity, HEAVY_VITEST_FILES } from './vitest-lanes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const config = path.join(root, 'vitest.heavy.config.ts');

// Keep this guard in the runner as well as the npm script so direct use cannot
// silently run a stale or incomplete heavy lane.
const counts = assertVitestLaneParity(root);
console.log(`Running ${counts.heavy} heavy Vitest files in fresh maxWorkers=1 processes.`);

for (const file of HEAVY_VITEST_FILES) {
  console.log(`\n===== heavy Vitest: ${file} =====`);
  const result = spawnSync(process.execPath, [vitestBin, 'run', '--config', config, file], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });

  if (result.error) {
    console.error(`Failed to start Vitest for ${file}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.signal) console.error(`Vitest terminated by ${result.signal} while running ${file}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nHeavy Vitest lane passed (${HEAVY_VITEST_FILES.length} fresh processes).`);
