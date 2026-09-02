import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const KG_SYNC_WORKER_MARKER_SCHEMA_VERSION = 'kg-sync-worker-marker/1.0' as const;
export const KG_SYNC_WORKER_MARKER_RELATIVE_PATH = '.workflow/kg-sync-worker.pid' as const;
export const DEFAULT_KG_SYNC_WORKER_STALE_MS = 5 * 60_000;
export const KG_SYNC_WORKER_MARKER_MAX_BYTES = 4 * 1024;
const KG_SYNC_WORKER_MAX_FUTURE_SKEW_MS = 60_000;
const INVALID_MARKER_GRACE_MS = 5_000;
const MUTATION_GUARD_WAIT_MS = 2_000;
const MUTATION_GUARD_OWNER_MAX_BYTES = 1_024;
const MUTATION_GUARD_NAME = '.kg-sync-worker-mutation.lock';
const MUTATION_GUARD_OWNER_NAME = 'owner.json';
/** A guard older than this can only belong to a crashed holder: the protected
 *  marker mutation completes in well under a second. */
const MUTATION_GUARD_STALE_MS = DEFAULT_KG_SYNC_WORKER_STALE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type KgSyncWorkerMode = 'worker' | 'maintenance';

export interface KgSyncWorkerMarker {
  schema_version: typeof KG_SYNC_WORKER_MARKER_SCHEMA_VERSION;
  pid: number;
  token: string;
  started_at: number;
  mode: KgSyncWorkerMode;
  legacy: false;
}

export interface LegacyKgSyncWorkerMarker {
  pid: number;
  token: null;
  started_at: null;
  mode: 'worker';
  legacy: true;
}

export type ParsedKgSyncWorkerMarker = KgSyncWorkerMarker | LegacyKgSyncWorkerMarker;

export type KgSyncWorkerMarkerInvalidReason =
  | 'unsafe-parent'
  | 'symlink'
  | 'not-regular'
  | 'too-large'
  | 'changed'
  | 'read-failed'
  | 'malformed'
  | 'future-timestamp'
  | 'future-mtime';

export interface KgSyncWorkerFileGeneration {
  device: number;
  inode: number;
}

export interface KgSyncWorkerToken {
  projectRoot: string;
  path: string;
  pid: number;
  token: string;
  startedAt: number;
  mode: KgSyncWorkerMode;
  inode: number;
  /** Additive generation fence used by hardened releases. */
  generation?: KgSyncWorkerFileGeneration;
  /** Lease duration used by the local heartbeat. */
  leaseMs?: number;
}

export interface KgSyncWorkerInspection {
  exists: boolean;
  live: boolean;
  owner: ParsedKgSyncWorkerMarker | null;
  /** A live PID from line one of a malformed versioned record. */
  foreignPid: number | null;
  ageMs: number;
  path: string;
  invalidReason?: KgSyncWorkerMarkerInvalidReason | null;
}

export interface AcquireKgSyncWorkerOptions {
  pid?: number;
  token?: string;
  now?: number;
  staleMs?: number;
  isPidLive?: (pid: number) => boolean;
}

export type AcquireKgSyncWorkerResult =
  | { acquired: true; token: KgSyncWorkerToken }
  | {
    acquired: false;
    reason: 'already-running';
    ownerMode: KgSyncWorkerMode | 'foreign';
    ownerPid: number | null;
    legacy: boolean;
  };

export class UnsafeKgSyncWorkerMarkerError extends Error {
  readonly code = 'KG_SYNC_WORKER_UNSAFE_PATH' as const;
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`Unsafe KG sync worker marker path ${path}: ${detail}`);
    this.name = 'UnsafeKgSyncWorkerMarkerError';
    this.path = path;
  }
}

export class KgSyncWorkerMutationBusyError extends Error {
  readonly code = 'KG_SYNC_WORKER_MUTATION_BUSY' as const;
  readonly path: string;

  constructor(path: string) {
    super(`Timed out acquiring KG sync worker mutation guard: ${path}`);
    this.name = 'KgSyncWorkerMutationBusyError';
    this.path = path;
  }
}

interface SafeWorkerMarkerPaths {
  canonicalRoot: string;
  workflowPath: string;
  markerPath: string;
  guardPath: string;
  parent: Stats;
}

interface MissingWorkerMarkerParent {
  canonicalRoot: string;
  workflowPath: string;
  markerPath: string;
  guardPath: string;
  parent: null;
}

type ResolvedWorkerMarkerPaths = SafeWorkerMarkerPaths | MissingWorkerMarkerParent;

interface MutationGuard {
  path: string;
  ownerPath: string;
  token: string;
  directory: Stats;
}

type WorkerMarkerFileRead =
  | { status: 'missing' }
  | {
    status: 'unsafe';
    stat: Stats | null;
    reason: Exclude<
      KgSyncWorkerMarkerInvalidReason,
      'unsafe-parent' | 'malformed' | 'future-timestamp' | 'future-mtime'
    >;
  }
  | { status: 'read'; raw: string; stat: Stats };

const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

export function kgSyncWorkerMarkerPath(projectRoot: string): string {
  let root = resolve(projectRoot);
  try { root = realpathSync(root); } catch { /* display-only path may not exist yet */ }
  return resolve(root, ...KG_SYNC_WORKER_MARKER_RELATIVE_PATH.split('/'));
}

/**
 * PID remains line one so the installed 0.5.63 `parseInt(...trim(), 10)` reader
 * sees a versioned marker as its original live-worker wire format.
 */
export function serializeKgSyncWorkerMarker(
  pid: number,
  token: string,
  startedAt: number,
  mode: KgSyncWorkerMode,
): string {
  assertPositivePid(pid);
  if (!UUID_PATTERN.test(token)) throw new Error('KG sync worker marker token must be a lowercase UUID');
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new Error('KG sync worker marker started_at must be a non-negative integer');
  }
  if (mode !== 'worker' && mode !== 'maintenance') {
    throw new Error('KG sync worker marker mode must be worker or maintenance');
  }
  const record = {
    schema_version: KG_SYNC_WORKER_MARKER_SCHEMA_VERSION,
    pid,
    token,
    started_at: startedAt,
    mode,
  };
  return `${pid}\n${JSON.stringify(record)}\n`;
}

/** Accepts only legacy decimal bytes or the exact versioned two-line record. */
export function parseKgSyncWorkerMarker(raw: string): ParsedKgSyncWorkerMarker | null {
  if (/^[1-9][0-9]*\n?$/.test(raw)) {
    const pid = Number(raw.trim());
    if (!Number.isSafeInteger(pid)) return null;
    return { pid, token: null, started_at: null, mode: 'worker', legacy: true };
  }

  const match = raw.match(/^([1-9][0-9]*)\n([^\n]+)\n$/);
  if (!match) return null;
  const linePid = Number(match[1]);
  if (!Number.isSafeInteger(linePid)) return null;

  let value: unknown;
  try {
    value = JSON.parse(match[2]);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const expectedKeys = ['schema_version', 'pid', 'token', 'started_at', 'mode'];
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) return null;
  if (
    value.schema_version !== KG_SYNC_WORKER_MARKER_SCHEMA_VERSION
    || value.pid !== linePid
    || !Number.isSafeInteger(value.pid)
    || typeof value.token !== 'string'
    || !UUID_PATTERN.test(value.token)
    || !Number.isSafeInteger(value.started_at)
    || (value.started_at as number) < 0
    || (value.mode !== 'worker' && value.mode !== 'maintenance')
  ) return null;

  return {
    schema_version: KG_SYNC_WORKER_MARKER_SCHEMA_VERSION,
    pid: value.pid as number,
    token: value.token,
    started_at: value.started_at as number,
    mode: value.mode,
    legacy: false,
  };
}

export function inspectKgSyncWorkerMarker(
  projectRoot: string,
  options: Pick<AcquireKgSyncWorkerOptions, 'now' | 'isPidLive'> = {},
): KgSyncWorkerInspection {
  const displayPath = kgSyncWorkerMarkerPath(projectRoot);
  const now = options.now ?? Date.now();
  const isPidLive = options.isPidLive ?? defaultIsPidLive;
  let paths: ResolvedWorkerMarkerPaths;
  try {
    paths = resolveSafeWorkerMarkerPaths(projectRoot, false);
  } catch (error) {
    if (!(error instanceof UnsafeKgSyncWorkerMarkerError)) throw error;
    return {
      exists: true,
      live: false,
      owner: null,
      foreignPid: null,
      ageMs: Number.MAX_SAFE_INTEGER,
      path: displayPath,
      invalidReason: 'unsafe-parent',
    };
  }
  if (paths.parent === null) {
    return missingInspection(paths.markerPath);
  }
  assertStableWorkerMarkerParent(paths);
  return inspectionFromWorkerMarkerRead(
    paths.markerPath,
    readWorkerMarkerFile(paths.markerPath),
    now,
    isPidLive,
  );
}

/** Exclusive marker creation is serialized with reclaim and release. */
export function acquireKgSyncWorkerToken(
  projectRoot: string,
  mode: KgSyncWorkerMode,
  options: AcquireKgSyncWorkerOptions = {},
): AcquireKgSyncWorkerResult {
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? DEFAULT_KG_SYNC_WORKER_STALE_MS;
  const isPidLive = options.isPidLive ?? defaultIsPidLive;
  assertPositivePid(pid);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('KG sync worker marker acquisition time must be a non-negative integer');
  }
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    throw new Error('KG sync worker marker staleMs must be a non-negative finite number');
  }

  const resolved = resolveSafeWorkerMarkerPaths(projectRoot, true);
  if (resolved.parent === null) {
    throw new UnsafeKgSyncWorkerMarkerError(resolved.workflowPath, 'marker parent is missing');
  }

  const result = withWorkerMarkerMutationGuard(resolved, (guard) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertStableWorkerMarkerParent(resolved);
      const read = readWorkerMarkerFile(resolved.markerPath);
      const inspection = inspectionFromWorkerMarkerRead(
        resolved.markerPath,
        read,
        now,
        isPidLive,
      );
      if (!inspection.exists) {
        const created = createWorkerMarkerFile(resolved, pid, token, now, mode, staleMs);
        if (created) return { acquired: true, token: created } as const;
        continue;
      }

      assertMarkerMutationSafe(resolved.markerPath, read);
      if (!isReclaimableInspection(inspection, staleMs)) {
        return {
          acquired: false,
          reason: 'already-running',
          ownerMode: inspection.owner?.mode ?? 'foreign',
          ownerPid: inspection.owner?.pid ?? inspection.foreignPid,
          legacy: inspection.owner?.legacy ?? false,
        } as const;
      }
      if (read.status === 'missing' || read.stat === null) {
        throw new UnsafeKgSyncWorkerMarkerError(resolved.markerPath, 'marker generation is unavailable');
      }
      assertMutationGuardOwnership(guard);
      unlinkWorkerMarkerGeneration(resolved, read.stat);
    }
    throw new UnsafeKgSyncWorkerMarkerError(
      resolved.markerPath,
      'marker changed repeatedly during acquisition',
    );
  });

  if (result.acquired) scheduleHeartbeat(result.token);
  return result;
}

/** Refreshes the finite lease without changing the marker generation. */
export function refreshKgSyncWorkerToken(
  token: KgSyncWorkerToken,
  now: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(now) || now < 0) return false;
  try {
    const resolved = resolveSafeWorkerMarkerPaths(token.projectRoot, false);
    if (resolved.parent === null || resolved.markerPath !== token.path) return false;
    return withWorkerMarkerMutationGuard(resolved, () => {
      assertStableWorkerMarkerParent(resolved);
      const read = readWorkerMarkerFile(resolved.markerPath);
      if (read.status !== 'read' || !matchesTokenGeneration(token, read.stat)) return false;
      const owner = parseKgSyncWorkerMarker(read.raw);
      if (!owner || owner.legacy || owner.pid !== token.pid || owner.token !== token.token) return false;
      const heartbeat = new Date(now);
      utimesSync(resolved.markerPath, heartbeat, heartbeat);
      const after = lstatSync(resolved.markerPath);
      return after.isFile() && matchesTokenGeneration(token, after);
    });
  } catch {
    return false;
  }
}

/** Removes only the same versioned token and filesystem generation acquired. */
export function releaseKgSyncWorkerToken(token: KgSyncWorkerToken): boolean {
  clearHeartbeat(token);
  try {
    const resolved = resolveSafeWorkerMarkerPaths(token.projectRoot, false);
    if (resolved.parent === null || resolved.markerPath !== token.path) return false;
    return withWorkerMarkerMutationGuard(resolved, (guard) => {
      assertStableWorkerMarkerParent(resolved);
      const read = readWorkerMarkerFile(resolved.markerPath);
      if (read.status !== 'read' || !matchesTokenGeneration(token, read.stat)) return false;
      const owner = parseKgSyncWorkerMarker(read.raw);
      if (!owner || owner.legacy || owner.pid !== token.pid || owner.token !== token.token) return false;
      assertMutationGuardOwnership(guard);
      unlinkWorkerMarkerGeneration(resolved, read.stat);
      return true;
    });
  } catch {
    return false;
  }
}

/** Reconstructs ownership in the detached worker after its parent wrote bytes. */
export function adoptKgSyncWorkerToken(
  projectRoot: string,
  pid: number,
  token: string,
): KgSyncWorkerToken | null {
  try {
    const resolved = resolveSafeWorkerMarkerPaths(projectRoot, false);
    if (resolved.parent === null) return null;
    const read = readWorkerMarkerFile(resolved.markerPath);
    if (read.status !== 'read') return null;
    const owner = parseKgSyncWorkerMarker(read.raw);
    if (!owner || owner.legacy || owner.pid !== pid || owner.token !== token) return null;
    const now = Date.now();
    if (
      owner.started_at > now + KG_SYNC_WORKER_MAX_FUTURE_SKEW_MS
      || markerAgeMs(now, read.stat.mtimeMs) >= DEFAULT_KG_SYNC_WORKER_STALE_MS
    ) return null;
    assertStableWorkerMarkerParent(resolved);
    const adopted: KgSyncWorkerToken = {
      projectRoot: resolved.canonicalRoot,
      path: resolved.markerPath,
      pid,
      token,
      startedAt: owner.started_at,
      mode: owner.mode,
      inode: read.stat.ino,
      generation: fileGeneration(read.stat),
      leaseMs: DEFAULT_KG_SYNC_WORKER_STALE_MS,
    };
    scheduleHeartbeat(adopted);
    return adopted;
  } catch {
    return null;
  }
}

export async function waitForKgSyncWorkerQuiescence(
  projectRoot: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const inspection = inspectKgSyncWorkerMarker(projectRoot);
    if (!inspection.exists || !inspection.live) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for KG sync ${inspection.owner?.mode ?? 'foreign'} owner PID ${inspection.owner?.pid ?? inspection.foreignPid ?? 'unknown'}`);
    }
    await new Promise(resolvePromise => setTimeout(
      resolvePromise,
      Math.min(50, Math.max(1, deadline - Date.now())),
    ));
  }
}

export async function withKgSyncMaintenanceToken<T>(
  projectRoot: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const acquired = acquireKgSyncWorkerToken(projectRoot, 'maintenance');
  if (!acquired.acquired) {
    throw new Error(`KG sync ${acquired.ownerMode} owner is already running`);
  }
  try {
    return await fn();
  } finally {
    releaseKgSyncWorkerToken(acquired.token);
  }
}

function resolveSafeWorkerMarkerPaths(
  projectRoot: string,
  createParent: boolean,
): ResolvedWorkerMarkerPaths {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(resolve(projectRoot));
  } catch {
    throw new UnsafeKgSyncWorkerMarkerError(resolve(projectRoot), 'project root is missing');
  }
  const rootStat = lstatSync(canonicalRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new UnsafeKgSyncWorkerMarkerError(canonicalRoot, 'project root is not a real directory');
  }

  const workflowPath = join(canonicalRoot, '.workflow');
  const markerPath = join(workflowPath, 'kg-sync-worker.pid');
  const guardPath = join(workflowPath, MUTATION_GUARD_NAME);
  let parent: Stats;
  try {
    parent = lstatSync(workflowPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new UnsafeKgSyncWorkerMarkerError(workflowPath, 'marker parent cannot be inspected');
    }
    if (!createParent) {
      return { canonicalRoot, workflowPath, markerPath, guardPath, parent: null };
    }
    try {
      mkdirSync(workflowPath, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
    parent = lstatSync(workflowPath);
  }
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new UnsafeKgSyncWorkerMarkerError(workflowPath, 'marker parent must be a real directory');
  }
  let canonicalParent: string;
  try {
    canonicalParent = realpathSync(workflowPath);
  } catch {
    throw new UnsafeKgSyncWorkerMarkerError(workflowPath, 'marker parent cannot be resolved');
  }
  if (comparablePath(canonicalParent) !== comparablePath(workflowPath)) {
    throw new UnsafeKgSyncWorkerMarkerError(workflowPath, 'marker parent escapes through a symlink');
  }
  return { canonicalRoot, workflowPath, markerPath, guardPath, parent };
}

function assertStableWorkerMarkerParent(paths: SafeWorkerMarkerPaths): void {
  let current: Stats;
  let canonicalParent: string;
  try {
    current = lstatSync(paths.workflowPath);
    canonicalParent = realpathSync(paths.workflowPath);
  } catch {
    throw new UnsafeKgSyncWorkerMarkerError(paths.workflowPath, 'marker parent changed');
  }
  if (
    current.isSymbolicLink()
    || !current.isDirectory()
    || !sameFilesystemEntry(paths.parent, current)
    || comparablePath(canonicalParent) !== comparablePath(paths.workflowPath)
  ) {
    throw new UnsafeKgSyncWorkerMarkerError(paths.workflowPath, 'marker parent changed or escaped');
  }
}

function withWorkerMarkerMutationGuard<T>(paths: SafeWorkerMarkerPaths, fn: (guard: MutationGuard) => T): T {
  const guard = acquireMutationGuard(paths);
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = fn(guard);
  } catch (error) {
    primaryError = error;
  }

  let releaseError: unknown;
  try {
    releaseMutationGuard(paths, guard);
  } catch (error) {
    releaseError = error;
  }
  if (primaryError !== undefined && releaseError !== undefined) {
    throw new AggregateError(
      [primaryError, releaseError],
      'KG sync worker mutation and guard release both failed',
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (releaseError !== undefined) throw releaseError;
  return result as T;
}

function acquireMutationGuard(paths: SafeWorkerMarkerPaths): MutationGuard {
  const deadline = Date.now() + MUTATION_GUARD_WAIT_MS;
  for (;;) {
    assertStableWorkerMarkerParent(paths);
    const token = randomUUID();
    try {
      mkdirSync(paths.guardPath, { mode: 0o700 });
      const directory = lstatSync(paths.guardPath);
      if (directory.isSymbolicLink() || !directory.isDirectory()) {
        throw new UnsafeKgSyncWorkerMarkerError(paths.guardPath, 'guard is not a real directory');
      }
      const ownerPath = join(paths.guardPath, MUTATION_GUARD_OWNER_NAME);
      writeFileSync(ownerPath, JSON.stringify({
        schema_version: 'kg-sync-worker-mutation-guard/1.0',
        pid: process.pid,
        token,
        created_at: Date.now(),
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      assertStableWorkerMarkerParent(paths);
      return { path: paths.guardPath, ownerPath, token, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        cleanupPartialMutationGuard(paths.guardPath, token);
        throw error;
      }
    }

    const state = inspectMutationGuard(paths.guardPath);
    if (state === 'unsafe') {
      throw new UnsafeKgSyncWorkerMarkerError(
        paths.guardPath,
        'mutation guard is malformed or requires manual cleanup',
      );
    }
    // A directory without a readable owner is transient while a competitor is
    // between mkdir and owner write (or mid-reclaim); only report it as
    // malformed once the deadline expires with no owner appearing.
    if (state === 'owner-missing' && Date.now() >= deadline) {
      throw new UnsafeKgSyncWorkerMarkerError(
        paths.guardPath,
        'mutation guard is malformed or requires manual cleanup',
      );
    }
    if (reclaimStaleMutationGuard(paths.guardPath, Date.now())) {
      continue;
    }
    if (Date.now() >= deadline) throw new KgSyncWorkerMutationBusyError(paths.guardPath);
    sleepSync(10);
  }
}

/**
 * Reclaims a guard whose owner record is intact but older than the lease.
 * PID liveness is intentionally not consulted: a reused PID would look alive
 * and deadlock the guard forever — the same finite-lease rationale as
 * isReclaimableInspection. Future timestamps (negative age) never reclaim.
 * Returns true only when both entries were removed; on any race the caller
 * simply re-enters the wait loop.
 *
 * 回收协议（认领→复核→删除）：先把 guard 目录 rename 到唯一认领名——
 * rename 是原子操作，只有一个回收者能成功，且此后原路径立即可被他人重建。
 * 随后复核认领目录里的 owner 与先前观测到的过期代际一致才删除；
 * 不一致说明原持有者已收尾、该路径被重建过，把目录放回原位（失败则由
 * assertMutationGuardOwnership 的 fencing 兜底，绝不误删新一代）。
 */
function reclaimStaleMutationGuard(path: string, now: number): boolean {
  const ownerPath = join(path, MUTATION_GUARD_OWNER_NAME);
  let owner: { pid: number; token: string; created_at: number } | null = null;
  try {
    owner = parseMutationGuardOwner(readBoundedRegularFile(
      ownerPath,
      MUTATION_GUARD_OWNER_MAX_BYTES,
    ).raw);
  } catch {
    return false; // Unreadable owners take the 'unsafe' path — never reclaim.
  }
  if (!owner) return false;
  if (!(now - owner.created_at >= MUTATION_GUARD_STALE_MS)) return false;

  const claimPath = `${path}.reclaim-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    renameSync(path, claimPath);
  } catch {
    return false; // 已被其他回收者认领,或原持有者已收尾删除
  }
  try {
    const claimed = parseMutationGuardOwner(readBoundedRegularFile(
      join(claimPath, MUTATION_GUARD_OWNER_NAME),
      MUTATION_GUARD_OWNER_MAX_BYTES,
    ).raw);
    if (!claimed || claimed.token !== owner.token || claimed.created_at !== owner.created_at) {
      // 代际已变:放回原位;原位被占则留给 fencing 兜底
      try { renameSync(claimPath, path); } catch { /* 新一代已在原位 */ }
      return false;
    }
    rmSync(claimPath, { recursive: true, force: true });
    return true;
  } catch {
    // 复核读取失败:目录身份不明,放回原位保守处理
    try { renameSync(claimPath, path); } catch { /* 新一代已在原位 */ }
    return false;
  }
}

/**
 * Fencing check before a destructive protected write: the guard may have
 * been reclaimed and recreated while this holder was suspended mid-section,
 * so ownership is re-verified between marker validation and the mutation
 * itself. The remaining check-then-act window is two adjacent syscalls,
 * which the filesystem cannot narrow further. Creation needs no fence (wx
 * is atomic) and refresh is already fenced by the stricter marker owner
 * comparison — unlink is the only destructive write.
 */
function assertMutationGuardOwnership(guard: MutationGuard): void {
  try {
    const current = lstatSync(guard.path);
    if (!sameFilesystemEntry(guard.directory, current) || !current.isDirectory()) {
      throw new Error('guard generation changed');
    }
    const owner = parseMutationGuardOwner(readBoundedRegularFile(
      guard.ownerPath,
      MUTATION_GUARD_OWNER_MAX_BYTES,
    ).raw);
    if (!owner || owner.token !== guard.token || owner.pid !== process.pid) {
      throw new Error('guard owner changed');
    }
  } catch (error) {
    if (error instanceof UnsafeKgSyncWorkerMarkerError) throw error;
    throw new UnsafeKgSyncWorkerMarkerError(
      guard.path,
      'mutation guard ownership lost before protected write',
    );
  }
}

function releaseMutationGuard(paths: SafeWorkerMarkerPaths, guard: MutationGuard): void {
  assertStableWorkerMarkerParent(paths);
  const currentDirectory = lstatSync(guard.path);
  if (!sameFilesystemEntry(guard.directory, currentDirectory) || !currentDirectory.isDirectory()) {
    throw new UnsafeKgSyncWorkerMarkerError(guard.path, 'mutation guard generation changed');
  }
  const owner = parseMutationGuardOwner(readBoundedRegularFile(
    guard.ownerPath,
    MUTATION_GUARD_OWNER_MAX_BYTES,
  ).raw);
  if (!owner || owner.token !== guard.token || owner.pid !== process.pid) {
    throw new UnsafeKgSyncWorkerMarkerError(guard.path, 'mutation guard owner changed');
  }
  unlinkSync(guard.ownerPath);
  rmdirSync(guard.path);
  assertStableWorkerMarkerParent(paths);
}

function inspectMutationGuard(path: string): 'busy' | 'unsafe' | 'owner-missing' {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return 'unsafe';
    const owner = parseMutationGuardOwner(readBoundedRegularFile(
      join(path, MUTATION_GUARD_OWNER_NAME),
      MUTATION_GUARD_OWNER_MAX_BYTES,
    ).raw);
    // A present but unparseable owner is genuinely malformed; a missing one
    // is transient (mid-creation or mid-reclaim).
    return owner ? 'busy' : 'unsafe';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'owner-missing';
    return 'unsafe';
  }
}

function parseMutationGuardOwner(
  raw: string,
): { pid: number; token: string; created_at: number } | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value)) return null;
  if (
    value.schema_version !== 'kg-sync-worker-mutation-guard/1.0'
    || !Number.isSafeInteger(value.pid)
    || (value.pid as number) <= 0
    || typeof value.token !== 'string'
    || !UUID_PATTERN.test(value.token)
    || !Number.isSafeInteger(value.created_at)
    || (value.created_at as number) < 0
  ) return null;
  return {
    pid: value.pid as number,
    token: value.token,
    created_at: value.created_at as number,
  };
}

function cleanupPartialMutationGuard(path: string, token: string): void {
  try {
    const ownerPath = join(path, MUTATION_GUARD_OWNER_NAME);
    const owner = parseMutationGuardOwner(readBoundedRegularFile(
      ownerPath,
      MUTATION_GUARD_OWNER_MAX_BYTES,
    ).raw);
    if (owner?.token !== token || owner.pid !== process.pid) return;
    unlinkSync(ownerPath);
    rmdirSync(path);
  } catch {
    // A partial or foreign guard remains visible for manual recovery.
  }
}

function createWorkerMarkerFile(
  paths: SafeWorkerMarkerPaths,
  pid: number,
  token: string,
  now: number,
  mode: KgSyncWorkerMode,
  leaseMs: number,
): KgSyncWorkerToken | null {
  assertStableWorkerMarkerParent(paths);
  let descriptor: number | null = null;
  let created: Stats | null = null;
  try {
    descriptor = openSync(paths.markerPath, 'wx', 0o600);
    writeFileSync(descriptor, serializeKgSyncWorkerMarker(pid, token, now, mode), 'utf8');
    created = fstatSync(descriptor);
    if (!created.isFile() || created.size > KG_SYNC_WORKER_MARKER_MAX_BYTES) {
      throw new UnsafeKgSyncWorkerMarkerError(paths.markerPath, 'creation produced an unsafe file');
    }
    closeSync(descriptor);
    descriptor = null;
    assertStableWorkerMarkerParent(paths);
    const atPath = lstatSync(paths.markerPath);
    if (atPath.isSymbolicLink() || !sameStableFile(created, atPath)) {
      throw new UnsafeKgSyncWorkerMarkerError(paths.markerPath, 'marker changed during creation');
    }
    return {
      projectRoot: paths.canonicalRoot,
      path: paths.markerPath,
      pid,
      token,
      startedAt: now,
      mode,
      inode: atPath.ino,
      generation: fileGeneration(atPath),
      leaseMs,
    };
  } catch (error) {
    if (descriptor !== null) {
      try { created = fstatSync(descriptor); } catch { /* preserve primary error */ }
      try { closeSync(descriptor); } catch { /* descriptor already closed */ }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    if (created) {
      try { unlinkWorkerMarkerGeneration(paths, created); } catch { /* preserve primary error */ }
    }
    throw error;
  }
}

function readWorkerMarkerFile(path: string): WorkerMarkerFileRead {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'unsafe', stat: null, reason: 'read-failed' };
  }
  if (before.isSymbolicLink()) return { status: 'unsafe', stat: before, reason: 'symlink' };
  if (!before.isFile()) return { status: 'unsafe', stat: before, reason: 'not-regular' };
  if (before.size > KG_SYNC_WORKER_MARKER_MAX_BYTES) {
    return { status: 'unsafe', stat: before, reason: 'too-large' };
  }
  try {
    const stable = readBoundedRegularFile(path, KG_SYNC_WORKER_MARKER_MAX_BYTES, before);
    return {
      status: 'read',
      raw: stable.raw,
      stat: stable.stat,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'unsafe', stat: before, reason: 'changed' };
  }
}

function readBoundedRegularFile(
  path: string,
  maxBytes: number,
  expected?: Stats,
): { raw: string; stat: Stats } {
  const before = expected ?? lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) {
    throw new Error('Unsafe bounded file');
  }
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, safeReadFlags());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new Error('Bounded file changed before open');
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error('Bounded file is too large');
    const afterRead = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (!sameStableFile(opened, afterRead) || !sameStableFile(afterRead, afterPath)) {
      throw new Error('Bounded file changed while reading');
    }
    return {
      raw: buffer.subarray(0, offset).toString('utf8'),
      stat: afterRead,
    };
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* descriptor already closed */ }
    }
  }
}

function inspectionFromWorkerMarkerRead(
  path: string,
  read: WorkerMarkerFileRead,
  now: number,
  isPidLive: (pid: number) => boolean,
): KgSyncWorkerInspection {
  if (read.status === 'missing') return missingInspection(path);
  if (read.status === 'unsafe') {
    return {
      exists: true,
      live: false,
      owner: null,
      foreignPid: null,
      ageMs: markerAgeMs(now, read.stat?.mtimeMs),
      path,
      invalidReason: read.reason,
    };
  }

  const owner = parseKgSyncWorkerMarker(read.raw);
  if (!owner) return invalidParsedInspection(path, read.raw, read.stat, now, isPidLive, 'malformed');
  if (read.stat.mtimeMs > now + KG_SYNC_WORKER_MAX_FUTURE_SKEW_MS) {
    return invalidParsedInspection(path, read.raw, read.stat, now, isPidLive, 'future-mtime');
  }
  if (!owner.legacy && owner.started_at > now + KG_SYNC_WORKER_MAX_FUTURE_SKEW_MS) {
    return invalidParsedInspection(path, read.raw, read.stat, now, isPidLive, 'future-timestamp');
  }
  const ageMs = markerAgeMs(now, read.stat.mtimeMs);
  return {
    exists: true,
    live: ageMs < DEFAULT_KG_SYNC_WORKER_STALE_MS && isPidLive(owner.pid),
    owner,
    foreignPid: null,
    ageMs,
    path,
    invalidReason: null,
  };
}

function missingInspection(path: string): KgSyncWorkerInspection {
  return {
    exists: false,
    live: false,
    owner: null,
    foreignPid: null,
    ageMs: 0,
    path,
    invalidReason: null,
  };
}

function invalidParsedInspection(
  path: string,
  raw: string,
  stat: Stats,
  now: number,
  isPidLive: (pid: number) => boolean,
  invalidReason: Extract<
    KgSyncWorkerMarkerInvalidReason,
    'malformed' | 'future-timestamp' | 'future-mtime'
  >,
): KgSyncWorkerInspection {
  const pid = firstLinePid(raw);
  return {
    exists: true,
    live: false,
    owner: null,
    foreignPid: pid !== null && isPidLive(pid) ? pid : null,
    ageMs: markerAgeMs(now, stat.mtimeMs),
    path,
    invalidReason,
  };
}

function assertMarkerMutationSafe(path: string, read: WorkerMarkerFileRead): void {
  if (read.status !== 'unsafe' || read.reason === 'too-large') return;
  throw new UnsafeKgSyncWorkerMarkerError(path, `marker is ${read.reason}`);
}

function unlinkWorkerMarkerGeneration(paths: SafeWorkerMarkerPaths, expected: Stats): void {
  assertStableWorkerMarkerParent(paths);
  const current = lstatSync(paths.markerPath);
  if (current.isSymbolicLink() || !current.isFile() || !sameFileIdentity(expected, current)) {
    throw new UnsafeKgSyncWorkerMarkerError(paths.markerPath, 'marker generation changed');
  }
  unlinkSync(paths.markerPath);
  assertStableWorkerMarkerParent(paths);
}

function isReclaimableInspection(inspection: KgSyncWorkerInspection, staleMs: number): boolean {
  if (inspection.invalidReason != null) {
    return inspection.ageMs >= Math.min(staleMs, INVALID_MARKER_GRACE_MS);
  }
  // Ownership is a finite lease. A reused or unrelated live PID cannot renew it.
  return inspection.ageMs >= staleMs;
}

function scheduleHeartbeat(token: KgSyncWorkerToken): void {
  clearHeartbeat(token);
  const leaseMs = token.leaseMs ?? DEFAULT_KG_SYNC_WORKER_STALE_MS;
  if (leaseMs <= 0) return;
  const intervalMs = Math.max(25, Math.min(Math.floor(leaseMs / 3), 30_000));
  const timer = setInterval(() => {
    if (!refreshKgSyncWorkerToken(token)) clearHeartbeat(token);
  }, intervalMs);
  timer.unref?.();
  heartbeatTimers.set(heartbeatKey(token), timer);
}

function clearHeartbeat(token: KgSyncWorkerToken): void {
  const key = heartbeatKey(token);
  const timer = heartbeatTimers.get(key);
  if (timer) clearInterval(timer);
  heartbeatTimers.delete(key);
}

function heartbeatKey(token: KgSyncWorkerToken): string {
  return `${token.path}\0${token.token}`;
}

function matchesTokenGeneration(token: KgSyncWorkerToken, stat: Stats): boolean {
  const generation = token.generation;
  return stat.isFile()
    && stat.ino === token.inode
    && (generation === undefined
      || (stat.dev === generation.device && stat.ino === generation.inode));
}

function fileGeneration(stat: Stats): KgSyncWorkerFileGeneration {
  return { device: stat.dev, inode: stat.ino };
}

function markerAgeMs(now: number, timestamp: number | undefined): number {
  if (
    timestamp === undefined
    || !Number.isFinite(timestamp)
    || timestamp < 0
    || timestamp > now + KG_SYNC_WORKER_MAX_FUTURE_SKEW_MS
  ) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, now - timestamp);
}

function safeReadFlags(): number {
  return constants.O_RDONLY
    | (constants.O_NOFOLLOW ?? 0)
    | (constants.O_NONBLOCK ?? 0);
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.isFile() === right.isFile();
}

function sameFilesystemEntry(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameStableFile(left: Stats, right: Stats): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function firstLinePid(raw: string): number | null {
  const first = raw.match(/^([1-9][0-9]*)(?:\n|$)/)?.[1];
  if (!first) return null;
  const pid = Number(first);
  return Number.isSafeInteger(pid) ? pid : null;
}

function defaultIsPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function assertPositivePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('KG sync worker marker PID must be a positive integer');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
