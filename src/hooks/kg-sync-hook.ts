/**
 * KG Sync Hook — UserPromptSubmit
 *
 * Silently syncs the Knowledge Graph when source files have changed.
 * Uses CodeGraph as the sole sync engine. Gracefully degrades when
 * CodeGraph is unavailable.
 *
 * Design: Pure evaluateXxx function + thin runner in hooks.ts.
 * Bridge file in os.tmpdir() for cooldown dedup across invocations.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { KG_SYNC_BRIDGE_PREFIX } from './constants.js';

const require = createRequire(import.meta.url);

/** Minimum seconds between sync attempts */
const COOLDOWN_SECONDS = 30;

/** Source extensions that trigger a sync */
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

interface KgSyncBridge {
  last_sync: number; // epoch seconds
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a KG sync is needed and perform it if so.
 * Uses MaestroGraph as the sync engine.
 */
export async function evaluateKgSync(
  projectPath: string,
  sessionId: string,
): Promise<KgSyncResult> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(projectPath)) {
      return { synced: false, reason: 'maestrograph-not-initialized' };
    }

    // Cooldown check via bridge file
    const bridge = readBridge(sessionId);
    if (bridge) {
      const elapsed = Math.floor(Date.now() / 1000) - bridge.last_sync;
      if (elapsed < COOLDOWN_SECONDS) {
        return { synced: false, reason: 'cooldown' };
      }
    }

    // Git quick check — any source files changed?
    if (!detectSourceChanges(projectPath)) {
      writeBridge(sessionId);
      return { synced: false, reason: 'no-changes' };
    }

    // Perform sync via MaestroGraph
    const start = Date.now();
    try {
      const mg = await MaestroGraph.open(projectPath);
      try {
        const results = await mg.sync();
        const filesChanged = results.reduce((sum, r) => sum + r.nodesAdded + r.nodesRemoved, 0);
        writeBridge(sessionId);
        return { synced: true, filesChanged, durationMs: Date.now() - start };
      } finally {
        mg.close();
      }
    } catch {
      return { synced: false, reason: 'sync-error' };
    }
  } catch {
    return { synced: false, reason: 'maestrograph-unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
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

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const filePath = line.slice(3).trim();
      const actualPath = filePath.includes(' -> ')
        ? filePath.split(' -> ')[1]
        : filePath;
      const dotIdx = actualPath.lastIndexOf('.');
      if (dotIdx >= 0) {
        const ext = actualPath.slice(dotIdx).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function bridgePath(sessionId: string): string {
  return join(tmpdir(), `${KG_SYNC_BRIDGE_PREFIX}${sessionId}.json`);
}

function readBridge(sessionId: string): KgSyncBridge | null {
  const path = bridgePath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as KgSyncBridge;
  } catch {
    return null;
  }
}

function writeBridge(sessionId: string): void {
  try {
    const data: KgSyncBridge = {
      last_sync: Math.floor(Date.now() / 1000),
      session_id: sessionId,
    };
    writeFileSync(bridgePath(sessionId), JSON.stringify(data), 'utf-8');
  } catch {
    // Best-effort
  }
}
