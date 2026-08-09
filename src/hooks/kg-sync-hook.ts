/**
 * KG Sync Hook — UserPromptSubmit
 *
 * Detects repository and exact external-surface changes from any nested cwd,
 * then delegates one transactionally-watermarked sync to a detached worker.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { invalidateSearchIndex } from '../search/daemon-client.js';
import { kgSyncGuard } from '../utils/cooldown-guard.js';
import {
  getGitHead,
  getSyncStateHealth,
  isSyncStateFresh,
  readSyncState,
  writeSyncStateFailure,
  type KgSyncFreshnessSnapshot,
} from '../graph/kg/sync-state.js';
import { isSupportedSourcePath } from '../graph/kg/extraction/code/supported-source-extensions.js';
import { resolveWorkspace } from './workspace.js';
import {
  acquireKgSyncWorkerToken,
  adoptKgSyncWorkerToken,
  inspectKgSyncWorkerMarker,
  releaseKgSyncWorkerToken,
  type KgSyncWorkerMode,
  type KgSyncWorkerToken,
} from './kg-sync-worker-state.js';

const WORKER_ENV = 'MAESTRO_KG_SYNC_WORKER';
const WORKER_TOKEN_ENV = 'MAESTRO_KG_SYNC_WORKER_TOKEN';

export interface KgSyncResult {
  synced: boolean;
  reason?: string;
  filesChanged?: number;
  durationMs?: number;
  projectRoot?: string;
  workerMode?: KgSyncWorkerMode | 'foreign';
}

export interface GitPorcelainEntry {
  status: string;
  paths: string[];
}

interface GitStatusSnapshot {
  available: boolean;
  changed: boolean;
  digest: string;
  entries: GitPorcelainEntry[];
}

type SpawnWorkerResult =
  | { status: 'spawned' }
  | { status: 'already-running'; mode: KgSyncWorkerMode | 'foreign' }
  | { status: 'unavailable' };

/**
 * Public entry accepts a nested cwd, but every guard and state path is keyed by
 * the one canonical Maestro project root.
 */
export async function evaluateKgSync(
  projectPath: string,
  sessionId: string,
): Promise<KgSyncResult> {
  const startedAt = Date.now();
  let projectRoot: string | null = null;
  try {
    projectRoot = canonicalWorkspace(projectPath);
    if (!projectRoot || !hasKgDatabase(projectRoot)) {
      return { synced: false, reason: 'maestrograph-not-initialized' };
    }

    const cooldownKey = kgSyncCooldownKey(sessionId, projectRoot);
    if (process.env[WORKER_ENV] === '1') {
      return await runSyncWorker(projectRoot, cooldownKey, startedAt);
    }

    const owner = inspectKgSyncWorkerMarker(projectRoot);
    if (owner.exists && owner.live) {
      const mode = owner.owner?.mode ?? 'foreign';
      return {
        synced: false,
        reason: mode === 'maintenance' ? 'already-running/maintenance' : 'already-running',
        projectRoot,
        workerMode: mode,
      };
    }

    const gitStatus = readGitStatus(projectRoot);
    const stateHealth = getSyncStateHealth(projectRoot);
    let freshness: KgSyncFreshnessSnapshot | null = null;
    try {
      freshness = await captureFreshness(projectRoot);
    } catch {
      // Invalid or racing manifest/exact headers are stale inputs. The worker
      // records the concrete extraction failure in lastAttempt.
    }

    const dirtySource = gitStatus.changed;
    const fresh = freshness !== null && isSyncStateFresh(readSyncState(projectRoot), freshness);
    if (!dirtySource && fresh) {
      kgSyncGuard.markDone(cooldownKey, { outcome: 'no-changes' });
      return { synced: false, reason: 'no-changes', projectRoot };
    }

    // Failed attempts stay retryable; they must not be hidden by a successful
    // prompt-side cooldown mark from an earlier worker.
    if (stateHealth.status !== 'error' && !kgSyncGuard.shouldRun(cooldownKey)) {
      return { synced: false, reason: 'cooldown', projectRoot };
    }

    const delegated = spawnSyncWorker(projectRoot, sessionId);
    if (delegated.status === 'spawned') {
      return { synced: false, reason: 'delegated', projectRoot };
    }
    if (delegated.status === 'already-running') {
      return {
        synced: false,
        reason: delegated.mode === 'maintenance'
          ? 'already-running/maintenance'
          : 'already-running',
        projectRoot,
        workerMode: delegated.mode,
      };
    }

    // Development/test entry points may not expose a runnable CLI file. Preserve
    // reliability with the same token-protected worker body in this process.
    return await runSyncWorker(projectRoot, cooldownKey, startedAt);
  } catch (error) {
    if (projectRoot) recordFailure(projectRoot, startedAt, error);
    debugError(error);
    return { synced: false, reason: 'sync-error', ...(projectRoot ? { projectRoot } : {}) };
  }
}

/** Parse `git status --porcelain=v1 -z` without trimming path bytes. */
export function parseGitPorcelainZ(output: string | Buffer): GitPorcelainEntry[] {
  const raw = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  const records = raw.split('\0');
  if (records.at(-1) === '') records.pop();
  const entries: GitPorcelainEntry[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.length < 3 || record[2] !== ' ') continue;
    const status = record.slice(0, 2);
    const paths = [record.slice(3)];
    if (/[RC]/.test(status)) {
      const oldPath = records[index + 1];
      if (oldPath !== undefined) {
        paths.push(oldPath);
        index++;
      }
    }
    entries.push({ status, paths });
  }
  return entries;
}

export function gitEntriesContainSupportedSource(entries: readonly GitPorcelainEntry[]): boolean {
  return entries.some(entry => entry.paths.some(isSupportedSourcePath));
}

export function detectSourceChanges(projectRoot: string): boolean {
  return readGitStatus(projectRoot).changed;
}

/** Same session in two repositories must never share a cooldown bridge. */
export function kgSyncCooldownKey(sessionId: string, canonicalProjectRoot: string): string {
  const projectHash = createHash('sha256').update(canonicalProjectRoot).digest('hex').slice(0, 24);
  return `${sessionId}:${projectHash}`;
}

async function runSyncWorker(
  projectRoot: string,
  cooldownKey: string,
  startedAt: number,
): Promise<KgSyncResult> {
  const ownership = acquireOrAdoptWorkerToken(projectRoot);
  if (!ownership.token) {
    return {
      synced: false,
      reason: ownership.mode === 'maintenance'
        ? 'already-running/maintenance'
        : 'already-running',
      projectRoot,
      workerMode: ownership.mode,
    };
  }

  const start = Date.now();
  let filesChanged = 0;
  let completedFresh = false;
  try {
    let beforeStatus = readGitStatus(projectRoot);
    for (let pass = 0; pass < 2; pass++) {
      const { MaestroGraph } = await import('../graph/kg/engine.js');
      const mg = await MaestroGraph.open(projectRoot);
      try {
        const results = await mg.sync();
        filesChanged += results.reduce((sum, result) =>
          sum + result.nodesAdded + result.nodesRemoved, 0);
      } finally {
        mg.close();
      }

      const afterStatus = readGitStatus(projectRoot);
      let stateFresh = false;
      try {
        stateFresh = isSyncStateFresh(
          readSyncState(projectRoot),
          await captureFreshness(projectRoot),
        );
      } catch {
        stateFresh = false;
      }
      const sourceInputsMoved = beforeStatus.digest !== afterStatus.digest;
      if (!sourceInputsMoved && stateFresh) {
        completedFresh = true;
        break;
      }
      if (pass === 1) break;
      beforeStatus = afterStatus;
    }

    if (completedFresh) {
      kgSyncGuard.markDone(cooldownKey, { outcome: 'worker-success' });
    } else {
      kgSyncGuard.clear(cooldownKey);
    }
    scheduleDerivedIndexes(projectRoot, filesChanged);
    return {
      synced: true,
      filesChanged,
      durationMs: Date.now() - start,
      projectRoot,
    };
  } catch (error) {
    kgSyncGuard.clear(cooldownKey);
    recordFailure(projectRoot, startedAt, error);
    debugError(error);
    return { synced: false, reason: 'sync-error', projectRoot };
  } finally {
    releaseKgSyncWorkerToken(ownership.token);
  }
}

function spawnSyncWorker(projectRoot: string, sessionId: string): SpawnWorkerResult {
  const current = inspectKgSyncWorkerMarker(projectRoot);
  if (current.exists && current.live) {
    return { status: 'already-running', mode: current.owner?.mode ?? 'foreign' };
  }

  const entry = process.argv[1];
  if (!entry || !/\.[cm]?js$/.test(entry)) return { status: 'unavailable' };
  const token = randomUUID();
  try {
    const child = spawn(
      process.execPath,
      [entry, 'hooks', 'run', 'kg-sync'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          [WORKER_ENV]: '1',
          [WORKER_TOKEN_ENV]: token,
        },
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      },
    );
    if (!child.pid) {
      child.kill();
      return { status: 'unavailable' };
    }

    const acquired = acquireKgSyncWorkerToken(projectRoot, 'worker', {
      pid: child.pid,
      token,
    });
    if (!acquired.acquired) {
      const owner = inspectKgSyncWorkerMarker(projectRoot);
      const sameChild = !owner.owner?.legacy
        && owner.owner?.pid === child.pid
        && owner.owner?.token === token;
      if (!sameChild) child.kill();
      if (sameChild) {
        child.stdin?.end(JSON.stringify({ session_id: sessionId, cwd: projectRoot }));
        child.unref();
        return { status: 'spawned' };
      }
      return { status: 'already-running', mode: acquired.ownerMode };
    }

    child.stdin?.end(JSON.stringify({ session_id: sessionId, cwd: projectRoot }));
    child.unref();
    return { status: 'spawned' };
  } catch {
    return { status: 'unavailable' };
  }
}

function acquireOrAdoptWorkerToken(projectRoot: string): {
  token: KgSyncWorkerToken | null;
  mode: KgSyncWorkerMode | 'foreign';
} {
  const inheritedToken = process.env[WORKER_TOKEN_ENV];
  if (process.env[WORKER_ENV] === '1' && inheritedToken) {
    const adopted = adoptKgSyncWorkerToken(projectRoot, process.pid, inheritedToken);
    if (adopted) return { token: adopted, mode: 'worker' };
    const acquired = acquireKgSyncWorkerToken(projectRoot, 'worker', { token: inheritedToken });
    if (acquired.acquired) return { token: acquired.token, mode: 'worker' };
    const owner = inspectKgSyncWorkerMarker(projectRoot);
    const retryAdopt = adoptKgSyncWorkerToken(projectRoot, process.pid, inheritedToken);
    if (retryAdopt) return { token: retryAdopt, mode: 'worker' };
    return { token: null, mode: owner.owner?.mode ?? 'foreign' };
  }

  const acquired = acquireKgSyncWorkerToken(projectRoot, 'worker');
  return acquired.acquired
    ? { token: acquired.token, mode: 'worker' }
    : { token: null, mode: acquired.ownerMode };
}

async function captureFreshness(projectRoot: string): Promise<KgSyncFreshnessSnapshot> {
  const { prepareExternalSurfaceScan } = await import(
    '../graph/kg/extraction/code/code-extractor.js'
  );
  const external = prepareExternalSurfaceScan(projectRoot);
  return {
    head: getGitHead(projectRoot),
    manifestDigest: external.manifest.digest,
    externalFingerprint: external.externalFingerprint,
  };
}

function readGitStatus(projectRoot: string): GitStatusSnapshot {
  try {
    const output = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      {
        cwd: projectRoot,
        encoding: 'buffer',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const entries = parseGitPorcelainZ(output);
    return {
      available: true,
      changed: gitEntriesContainSupportedSource(entries),
      digest: createHash('sha256').update(output).digest('hex'),
      entries,
    };
  } catch {
    return { available: false, changed: false, digest: '', entries: [] };
  }
}

function canonicalWorkspace(cwd: string): string | null {
  const workspace = resolveWorkspace({ cwd });
  if (!workspace) return null;
  try {
    return realpathSync(workspace);
  } catch {
    return resolve(workspace);
  }
}

function hasKgDatabase(projectRoot: string): boolean {
  return existsSync(resolve(projectRoot, '.workflow', 'kg', 'maestro.db'));
}

function recordFailure(projectRoot: string, startedAt: number, error: unknown): void {
  try {
    writeSyncStateFailure(projectRoot, startedAt, error);
  } catch (stateError) {
    debugError(new AggregateError([error, stateError], 'KG sync and failure-state write failed'));
  }
}

function debugError(error: unknown): void {
  if (process.env.MAESTRO_DEBUG === '1') {
    console.error(`[kg-sync] sync failed: ${error instanceof Error ? error.message : error}`);
  }
}

function scheduleDerivedIndexes(projectRoot: string, filesChanged: number): void {
  if (filesChanged <= 0) return;
  invalidateSearchIndex(resolve(projectRoot, '.workflow')).catch(() => {});
  import('../graph/kg/engine.js').then(({ MaestroGraph }) =>
    MaestroGraph.open(projectRoot).then(graph =>
      graph.buildCodeEmbeddings().catch((error: unknown) => {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.warn(`[kg-sync] code embedding build failed: ${error instanceof Error ? error.message : error}`);
        }
      }).finally(() => graph.close())
    )
  ).catch(() => {});
}
