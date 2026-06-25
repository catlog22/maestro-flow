/**
 * KG Sync Hook — UserPromptSubmit
 *
 * Silently syncs the Knowledge Graph when source files have changed.
 * Uses CooldownGuard for cross-process debouncing.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { kgSyncGuard } from '../utils/cooldown-guard.js';
import { invalidateSearchIndex } from '../search/daemon-client.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgSyncResult {
  synced: boolean;
  reason?: string;
  filesChanged?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function evaluateKgSync(
  projectPath: string,
  sessionId: string,
): Promise<KgSyncResult> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(projectPath)) {
      return { synced: false, reason: 'maestrograph-not-initialized' };
    }

    if (!kgSyncGuard.shouldRun(sessionId)) {
      return { synced: false, reason: 'cooldown' };
    }

    if (!detectSourceChanges(projectPath)) {
      kgSyncGuard.markDone(sessionId);
      return { synced: false, reason: 'no-changes' };
    }

    const start = Date.now();
    const mg = await MaestroGraph.open(projectPath);
    try {
      const results = await mg.sync();
      const filesChanged = results.reduce((sum, r) => sum + r.nodesAdded + r.nodesRemoved, 0);
      kgSyncGuard.markDone(sessionId);
      if (filesChanged > 0) {
        invalidateSearchIndex(resolve(projectPath, '.workflow')).catch(() => {});
      }
      return { synced: true, filesChanged, durationMs: Date.now() - start };
    } finally {
      mg.close();
    }
  } catch {
    return { synced: false, reason: 'sync-error' };
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function detectSourceChanges(projectPath: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!output.trim()) return false;
    for (const line of output.trim().split('\n')) {
      const filePath = line.slice(3).trim();
      const actualPath = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;
      const dotIdx = actualPath.lastIndexOf('.');
      if (dotIdx >= 0 && SOURCE_EXTENSIONS.has(actualPath.slice(dotIdx).toLowerCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}
