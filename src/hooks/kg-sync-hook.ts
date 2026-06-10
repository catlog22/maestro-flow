/**
 * KG Sync Hook — UserPromptSubmit
 *
 * Silently syncs the Knowledge Graph when source files have changed.
 * Runs as a background side-effect on each user prompt — never blocks
 * or modifies the prompt. Gracefully degrades when the KG database
 * or better-sqlite3 is unavailable.
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
 *
 * @param projectPath  Working directory (project root)
 * @param sessionId    Session ID for bridge file scoping
 * @returns KgSyncResult indicating what happened
 */
export async function evaluateKgSync(
  projectPath: string,
  sessionId: string,
): Promise<KgSyncResult> {
  // Step 1: Check if KG database exists
  let getDatabasePath: (root?: string) => string;
  try {
    // Dynamic require to avoid crash when better-sqlite3 is unavailable
    const dbMod = require('../graph/db/index.js');
    getDatabasePath = dbMod.getDatabasePath;
  } catch {
    return { synced: false, reason: 'no-graph-module' };
  }

  const dbPath = getDatabasePath(projectPath);
  if (!existsSync(dbPath)) {
    return { synced: false, reason: 'no-db' };
  }

  // Step 2: Cooldown check via bridge file
  const bridge = readBridge(sessionId);
  if (bridge) {
    const elapsed = Math.floor(Date.now() / 1000) - bridge.last_sync;
    if (elapsed < COOLDOWN_SECONDS) {
      return { synced: false, reason: 'cooldown' };
    }
  }

  // Step 3: Git quick check — any source files changed?
  const hasSourceChanges = detectSourceChanges(projectPath);
  if (!hasSourceChanges) {
    // Update bridge timestamp even when no changes, to avoid re-checking git
    writeBridge(sessionId);
    return { synced: false, reason: 'no-changes' };
  }

  // Step 4: Perform incremental sync — prefer CodeGraph, fallback to IncrementalSync
  const start = Date.now();

  // Step 4a: Try CodeGraph tree-sitter engine first
  try {
    const cgMod = require('../graph/codegraph-adapter.js');
    if (cgMod.isCodeGraphAvailable()) {
      const adapter = new cgMod.CodeGraphAdapter(projectPath);
      try {
        if (adapter.isInitialized()) {
          const result = await adapter.sync();
          const filesChanged = result.filesAdded + result.filesModified + result.filesRemoved;
          writeBridge(sessionId);
          return {
            synced: true,
            filesChanged,
            durationMs: Date.now() - start,
          };
        }
      } finally {
        try { adapter.close(); } catch { /* best-effort */ }
      }
    }
  } catch {
    // CodeGraph not available — fall through to IncrementalSync
  }

  // Step 4b: Fallback to IncrementalSync (regex-based)
  try {
    const dbMod = require('../graph/db/index.js');
    const syncMod = require('../graph/sync/incremental-sync.js');
    const DatabaseConnection = dbMod.DatabaseConnection;
    const IncrementalSync = syncMod.IncrementalSync;

    const conn = new DatabaseConnection();
    try {
      conn.open(dbPath);
      const syncer = new IncrementalSync(projectPath, conn);
      const result = syncer.sync();

      // Step 5: Write bridge with timestamp
      writeBridge(sessionId);

      return {
        synced: true,
        filesChanged: result.filesChanged,
        durationMs: Date.now() - start,
      };
    } finally {
      try { conn.close(); } catch { /* best-effort */ }
    }
  } catch {
    // Graph modules failed at runtime — degrade silently
    writeBridge(sessionId); // avoid retrying immediately
    return { synced: false, reason: 'sync-error' };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Quick git status check filtered to source extensions.
 * Returns true if any source files have uncommitted changes.
 */
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
      // Format: "XY filename" — filename starts at index 3
      const filePath = line.slice(3).trim();
      // Handle renamed files: "R  old -> new"
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
    // Not a git repo or git not available — skip
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
    // Best-effort — don't fail the hook if bridge write fails
  }
}
