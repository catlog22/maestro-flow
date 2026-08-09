/**
 * Read-only fixture copied from maestro-flow commit
 * 12d25cf9e09bc49c6f7fa1800db2b48d39b20b3f (`kg-sync-hook.ts`).
 * Keep the parseInt wire behavior unchanged for deployment compatibility gates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function workerAlreadyRunningV063(projectPath: string): boolean {
  try {
    const pid = parseInt(readFileSync(
      resolve(projectPath, '.workflow', 'kg-sync-worker.pid'),
      'utf-8',
    ).trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
