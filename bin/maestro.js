#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  shouldApplyWasmFlags,
  processHasWasmRuntimeFlags,
  buildRelaunchArgv,
  isNodeVersionWasmSensitive,
} from '../dist/src/utils/wasm-relaunch.js';

const WASM_RELAUNCH_GUARD = 'MAESTRO_WASM_RELAUNCHED';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const scriptArgs = process.argv.slice(2);
const needsWasmFlags = shouldApplyWasmFlags(scriptArgs);

if (
  needsWasmFlags &&
  !processHasWasmRuntimeFlags() &&
  !process.env[WASM_RELAUNCH_GUARD] &&
  !process.env.MAESTRO_NO_WASM_RELAUNCH
) {
  const result = spawnSync(process.execPath, buildRelaunchArgv(SCRIPT_PATH, scriptArgs), {
    stdio: 'inherit',
    env: { ...process.env, [WASM_RELAUNCH_GUARD]: '1' },
    windowsHide: true,
  });

  if (result.error) {
    process.env[WASM_RELAUNCH_GUARD] = '1';
    process.stderr.write(
      `[MaestroGraph] Warning: Failed to relaunch with WASM flags (${result.error.message}). ` +
      'Continuing without --liftoff-only; large repositories may trigger V8 WASM OOM.\n',
    );
  } else {
    const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
    process.exit(result.status ?? SIGNAL_EXIT_CODES[result.signal] ?? 1);
  }
}

if (needsWasmFlags && isNodeVersionWasmSensitive() && !process.env.MAESTRO_ALLOW_UNSAFE_NODE) {
  process.stderr.write(
    '[MaestroGraph] Warning: Node 25.x is sensitive to V8 WASM Zone OOM during tree-sitter indexing. ' +
    'Node 22 LTS is recommended for large repositories.\n',
  );
}

await import('../dist/src/cli.js');
