/**
 * KG Sync State — persistent freshness watermark for codegraph sync.
 *
 * Records the git HEAD at the last successful codegraph sync in
 * .workflow/kg/sync-state.json so change detection can catch committed
 * changes (commit / pull / branch switch) that leave the working tree clean.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface KgSyncState {
  lastSyncHead: string | null;
  lastSyncAt: number;
}

function syncStatePath(projectPath: string): string {
  return resolve(projectPath, '.workflow', 'kg', 'sync-state.json');
}

export function readSyncState(projectPath: string): KgSyncState | null {
  try {
    const data = JSON.parse(readFileSync(syncStatePath(projectPath), 'utf-8')) as KgSyncState;
    return typeof data.lastSyncAt === 'number' ? data : null;
  } catch {
    return null;
  }
}

export function writeSyncState(projectPath: string, head: string | null): void {
  try {
    const path = syncStatePath(projectPath);
    mkdirSync(dirname(path), { recursive: true });
    const data: KgSyncState = { lastSyncHead: head, lastSyncAt: Date.now() };
    writeFileSync(path, JSON.stringify(data), 'utf-8');
  } catch {
    // Best-effort — freshness falls back to dirty-file detection.
  }
}

export function getGitHead(projectPath: string): string | null {
  try {
    const head = execSync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return head || null;
  } catch {
    return null;
  }
}
