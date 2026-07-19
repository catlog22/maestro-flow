import {
  copyFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { safeRename } from '../utils/state-schema.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import {
  artifactRegistrySchema,
  commandRunReadSchema,
  commandRunV13Schema,
  evidenceStoreSchema,
  gateRegistrySchema,
  normalizeCommandRun,
  sessionStateSchema,
  sessionStateV13Schema,
  targetPlatformSchema,
  type ArtifactRegistry,
  type CommandRun,
  type EvidenceStore,
  type GateRegistry,
  type SessionState,
} from './schemas.js';
import { createArtifactRegistry, createEvidenceStore, createGateRegistry, createSessionState } from './defaults.js';
import { assertSafePathSegment } from './ids.js';
import { canonicalWorkspaceId, createIntentIdentity, sameIntentIdentity } from './intent-identity.js';
import {
  recallConfirmationFinalTargetSchema,
  recallConfirmationRecordSchema,
  recallConfirmationRegistrySchema,
  recallReservationMarkerSchema,
  recallReservationObservationSchema,
  recallReservationReconciliationSchema,
  transitionFenceSchema,
  validatedRecallSourceSchema,
  type IntentIdentity,
  type RecallConfirmationFinalTarget,
  type RecallConfirmationOutcome,
  type RecallConfirmationRecord,
  type RecallConfirmationRegistry,
  type RecallConfirmationTargetIdentity,
  type RecallReservationMarker,
  type RecallReservationObservation,
  type RecallReservationReconciliation,
  type SessionProvenance,
  type StaleRecallReservation,
  type TransitionFence,
  type TransitionOutcome,
  type TransitionRequest,
  type ValidatedRecallSource,
} from './protocol-schemas.js';
import {
  assertRecallConfirmationConsumable,
  cancelRecallConfirmationRecord,
  createRecallReservationMarker,
  createStaleRecallReservation,
  createRecallConfirmationRegistry,
  finalizeRecallConfirmationRecord,
  hashRecallConfirmationToken,
  issueRecallConfirmationRecord,
  reserveRecallConfirmationRecord,
  RECALL_CONFIRMATION_RECONCILIATION_TTL_MS,
  RecallConfirmationError,
  type FinalizeRecallConfirmationInput,
  type IssueRecallConfirmationInput,
  type ReserveRecallConfirmationInput,
  type ReserveRecallConfirmationResult,
} from './recall-confirmation-store.js';
import { replayOrApplyTransition, stableJsonUtf8 } from './transition-receipts.js';

const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 15;
const MAX_BACKUPS = 10;
const CACHE_MAX_ENTRIES = 64;
const TRANSACTION_INTENT_FILE = '.session-store-transaction.json';

const lockRecordSchema = z.object({
  schema_version: z.literal('session-store-lock/1.0').optional(),
  pid: z.number().int().positive(),
  token: z.string().min(16).optional(),
  acquired_at: z.number().int().nonnegative(),
}).strict();

interface LockFileIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

interface LockSnapshot {
  raw: string;
  owner: z.infer<typeof lockRecordSchema>;
  identity: LockFileIdentity;
}

function lockFileIdentity(stats: ReturnType<typeof fstatSync>): LockFileIdentity {
  return {
    dev: Number(stats.dev),
    ino: Number(stats.ino),
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    birthtimeMs: Number(stats.birthtimeMs),
  };
}

function sameLockIdentity(left: LockFileIdentity, right: LockFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function sameLockSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.raw === right.raw
    && left.owner.pid === right.owner.pid
    && left.owner.token === right.owner.token
    && left.owner.acquired_at === right.owner.acquired_at
    && sameLockIdentity(left.identity, right.identity);
}

/**
 * Read one immutable lock-file generation through an fd. A missing, partial or
 * replaced path is normal contention and returns null so the caller can retry.
 */
function readStableLockSnapshot(path: string): LockSnapshot | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const before = lockFileIdentity(fstatSync(fd));
    const raw = readFileSync(fd, 'utf8');
    const after = lockFileIdentity(fstatSync(fd));
    if (!sameLockIdentity(before, after)) return null;
    const pathIdentity = lockFileIdentity(statSync(path));
    if (!sameLockIdentity(after, pathIdentity)) return null;
    const owner = lockRecordSchema.safeParse(JSON.parse(raw));
    if (!owner.success) return null;
    return { raw, owner: owner.data, identity: after };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* fd already closed */ }
    }
  }
}

const transactionIntentSchema = z.object({
  schema_version: z.literal('session-store-intent/1.0'),
  transaction_id: z.string().min(1),
  created_at: z.string().min(1),
  writes: z.array(z.object({
    path: z.string().min(1),
    tmp_path: z.string().min(1),
    original_base64: z.string().nullable(),
    original_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    next_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1),
}).strict();

type TransactionIntent = z.infer<typeof transactionIntentSchema>;

interface CacheEntry {
  mtime: number;
  size: number;
  data: unknown;
}

export interface SessionBundle {
  session: SessionState;
  gates: GateRegistry;
  artifacts: ArtifactRegistry;
  evidence: EvidenceStore;
}

export interface SessionListFilters {
  statuses?: SessionState['status'][];
  engines?: SessionState['orchestration']['engine'][];
  intentIdentity?: IntentIdentity;
}

export interface SessionListCandidate {
  sessionId: string;
  session: SessionState;
  identity: IntentIdentity | null;
}

export interface SessionListExclusion {
  sessionId: string;
  code: 'CORRUPT' | 'STATUS_FILTERED' | 'ENGINE_FILTERED' | 'IDENTITY_MISMATCH' | 'IDENTITY_UNAVAILABLE';
  detail: string;
}

export interface SessionListResult {
  candidates: SessionListCandidate[];
  exclusions: SessionListExclusion[];
}

export type SessionStoreReserveRecallResult = ReserveRecallConfirmationResult & {
  validated_source: ValidatedRecallSource | null;
};

interface JsonWrite {
  path: string;
  value: unknown;
  schema?: z.ZodType;
}

export interface SessionStoreLockTiming {
  now: () => number;
  wait: (milliseconds: number) => void;
}

export interface SessionStoreOptions {
  lockTiming?: Partial<SessionStoreLockTiming>;
}

const RETRYABLE_WINDOWS_LOCK_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

class SessionStoreLock {
  private readonly path: string;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => void;
  private held = false;
  private token: string | null = null;

  constructor(path: string, timing: Partial<SessionStoreLockTiming> = {}) {
    this.path = path;
    this.now = timing.now ?? Date.now;
    this.wait = timing.wait ?? waitSync;
  }

  get isHeld(): boolean { return this.held; }

  acquire(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const deadline = this.now() + LOCK_WAIT_MS;
    const token = randomBytes(24).toString('base64url');
    while (true) {
      try {
        writeFileSync(this.path, JSON.stringify({
          schema_version: 'session-store-lock/1.0',
          pid: process.pid,
          token,
          acquired_at: this.now(),
        }), { flag: 'wx' });
        this.token = token;
        this.held = true;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && code !== 'EEXIST') throw error;
      }

      const snapshot = readStableLockSnapshot(this.path);
      if (!snapshot) {
        this.waitForRetry(deadline);
        continue;
      }
      const liveness = processLiveness(snapshot.owner.pid);
      const verified = readStableLockSnapshot(this.path);
      if (!verified || !sameLockSnapshot(snapshot, verified)) {
        this.waitForRetry(deadline);
        continue;
      }
      if (liveness === 'dead') {
        try {
          unlinkSync(this.path);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') continue;
          if (code && RETRYABLE_WINDOWS_LOCK_ERRORS.has(code)) {
            this.waitForRetry(deadline);
            continue;
          }
          throw error;
        }
        continue;
      }
      if (verified.owner.pid === process.pid || liveness === 'unknown' || this.now() >= deadline) {
        throw new Error(`SessionStore locked by PID ${verified.owner.pid}: ${this.path}`);
      }
      this.wait(LOCK_POLL_MS);
    }
  }

  private waitForRetry(deadline: number): void {
    if (this.now() >= deadline) throw new Error(`Cannot safely inspect SessionStore lock: ${this.path}`);
    this.wait(LOCK_POLL_MS);
  }

  release(): void {
    if (!this.held) return;
    try {
      const snapshot = readStableLockSnapshot(this.path);
      if (snapshot?.owner.pid === process.pid && snapshot.owner.token === this.token) {
        const verified = readStableLockSnapshot(this.path);
        if (verified && sameLockSnapshot(snapshot, verified)) unlinkSync(this.path);
      }
    } catch { /* already removed */ }
    this.held = false;
    this.token = null;
  }
}

function waitSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'unknown';
    return 'unknown';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.\-TZ]/g, '').slice(0, 14);
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Prefixed(value: string | Buffer): string {
  return `sha256:${sha256Hex(value)}`;
}

export class SessionStore {
  readonly projectRoot: string;
  readonly workflowRoot: string;
  readonly sessionsRoot: string;
  private readonly lock: SessionStoreLock;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(projectRoot: string, options: SessionStoreOptions = {}) {
    this.projectRoot = projectRoot;
    this.workflowRoot = join(projectRoot, '.workflow');
    this.sessionsRoot = join(this.workflowRoot, 'sessions');
    this.lock = new SessionStoreLock(join(this.sessionsRoot, '.session-store.lock'), options.lockTiming);
  }

  sessionDir(sessionId: string): string {
    assertSafePathSegment(sessionId, 'session ID');
    return join(this.sessionsRoot, sessionId);
  }

  runDir(sessionId: string, runId: string): string {
    assertSafePathSegment(runId, 'run ID');
    return join(this.sessionDir(sessionId), 'runs', runId);
  }

  withLock<T>(fn: () => T): T {
    this.lock.acquire();
    try {
      this.reconcileTransactionIntentUnlocked();
      return fn();
    } finally { this.lock.release(); }
  }

  sessionExists(sessionId: string): boolean {
    return existsSync(join(this.sessionDir(sessionId), 'session.json'));
  }

  createSession(
    sessionId: string,
    intent: string,
    options: {
      ifExists?: 'reuse' | 'error';
      command?: string;
      intentIdentity?: IntentIdentity;
      provenance?: SessionProvenance;
    } = {},
  ): SessionBundle {
    return this.withLock(() => {
      if (this.sessionExists(sessionId)) {
        if (options.ifExists === 'error') throw new Error(`Session already exists: ${sessionId}`);
        const existing = this.readBundleUnlocked(sessionId);
        this.ensureSessionProjections(sessionId, existing.session.intent);
        return clone(existing);
      }
      this.assertRecoverableSessionShell(sessionId, intent);
      const intentIdentity = options.intentIdentity
        ?? createIntentIdentity(this.projectRoot, options.command ?? 'session', intent);
      const bundle: SessionBundle = {
        session: createSessionState(sessionId, intent, {
          intentIdentity,
          ...(options.provenance ? { provenance: options.provenance } : {}),
        }),
        gates: createGateRegistry(),
        artifacts: createArtifactRegistry(),
        evidence: createEvidenceStore(),
      };
      this.writeBundleUnlocked(sessionId, bundle);
      this.ensureSessionProjections(sessionId, intent);
      return clone(bundle);
    });
  }

  private assertRecoverableSessionShell(sessionId: string, intent: string): void {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) return;
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(`SessionStore recovery required: invalid Session shell at ${dir}`);
    }
    const allowedDirectories = new Set(['runs', 'specs', 'knowhow']);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        throw new Error(`SessionStore recovery required: symbolic link in Session shell: ${path}`);
      }
      if (allowedDirectories.has(name)) {
        if (!stats.isDirectory() || readdirSync(path).length > 0) {
          throw new Error(`SessionStore recovery required: non-empty or invalid projection directory: ${path}`);
        }
        continue;
      }
      if (name === 'events.ndjson') {
        if (!stats.isFile() || stats.size !== 0) {
          throw new Error(`SessionStore recovery required: conflicting events projection: ${path}`);
        }
        continue;
      }
      if (name === 'context.md') {
        if (!stats.isFile() || readFileSync(path, 'utf8') !== `# ${intent}\n`) {
          throw new Error(`SessionStore recovery required: conflicting context projection: ${path}`);
        }
        continue;
      }
      throw new Error(`SessionStore recovery required: unknown Session shell entry: ${path}`);
    }
  }

  private ensureSessionProjections(sessionId: string, intent: string): void {
    const dir = this.sessionDir(sessionId);
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(`SessionStore recovery required: invalid canonical Session directory: ${dir}`);
    }
    for (const name of ['runs', 'specs', 'knowhow']) {
      const path = join(dir, name);
      if (!existsSync(path)) {
        mkdirSync(path);
        continue;
      }
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`SessionStore recovery required: invalid projection directory: ${path}`);
      }
    }
    const eventsPath = join(dir, 'events.ndjson');
    if (!existsSync(eventsPath)) writeFileSync(eventsPath, '', { flag: 'wx' });
    else {
      const stats = lstatSync(eventsPath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`SessionStore recovery required: invalid events projection: ${eventsPath}`);
      }
    }
    const contextPath = join(dir, 'context.md');
    if (!existsSync(contextPath)) writeFileSync(contextPath, `# ${intent}\n`, { flag: 'wx' });
    else {
      const stats = lstatSync(contextPath);
      if (stats.isSymbolicLink() || !stats.isFile() || readFileSync(contextPath, 'utf8') !== `# ${intent}\n`) {
        throw new Error(`SessionStore recovery required: conflicting context projection: ${contextPath}`);
      }
    }
  }

  readBundle(sessionId: string): SessionBundle {
    if (!this.lock.isHeld) return this.withLock(() => this.readBundleUnlocked(sessionId));
    return this.readBundleUnlocked(sessionId);
  }

  private readBundleUnlocked(sessionId: string): SessionBundle {
    const dir = this.sessionDir(sessionId);
    return {
      session: this.readValidated(join(dir, 'session.json'), sessionStateSchema),
      gates: this.readValidated(join(dir, 'gates.json'), gateRegistrySchema),
      artifacts: this.readValidated(join(dir, 'artifacts.json'), artifactRegistrySchema),
      evidence: this.readValidated(join(dir, 'evidence.json'), evidenceStoreSchema),
    };
  }

  readRun(sessionId: string, runId: string): CommandRun {
    if (!this.lock.isHeld) return this.withLock(() => this.readRunUnlocked(sessionId, runId));
    return this.readRunUnlocked(sessionId, runId);
  }

  private readRunUnlocked(sessionId: string, runId: string): CommandRun {
    const raw = this.readValidated(join(this.runDir(sessionId, runId), 'run.json'), commandRunReadSchema);
    if (raw.schema_version === 'command-run/1.3') return raw;
    const session = this.readValidated(join(this.sessionDir(sessionId), 'session.json'), sessionStateSchema);
    const executorPlatform = targetPlatformSchema.safeParse(session.orchestration.executor?.platform);
    return normalizeCommandRun(raw, executorPlatform.success ? executorPlatform.data : 'claude');
  }

  update<T>(sessionId: string, mutator: (draft: SessionBundle, tx: StoreTransaction) => T): T {
    return this.withLock(() => {
      const current = this.readBundle(sessionId);
      if (current.session.status === 'sealed' || current.session.status === 'archived') {
        throw new Error(`Session ${sessionId} is ${current.session.status} and immutable`);
      }
      const draft = clone(current);
      const tx = new StoreTransaction(this, sessionId);
      const result = mutator(draft, tx);
      // Compatible reads normalize legacy sessions in memory; every mutation
      // persists the coordinated canonical generation.
      draft.session.schema_version = 'session/1.3';
      sessionStateV13Schema.parse(draft.session);
      gateRegistrySchema.parse(draft.gates);
      artifactRegistrySchema.parse(draft.artifacts);
      evidenceStoreSchema.parse(draft.evidence);
      tx.addBundle(draft);
      this.writeBatchUnlocked(tx.writes);
      return result;
    });
  }

  findRun(runId: string, sessionId?: string): { sessionId: string; run: CommandRun } {
    if (sessionId) return { sessionId, run: this.readRun(sessionId, runId) };
    if (!existsSync(this.sessionsRoot)) throw new Error(`Run not found: ${runId}`);
    const matches: string[] = [];
    for (const candidate of readdirSync(this.sessionsRoot)) {
      if (existsSync(join(this.runDir(candidate, runId), 'run.json'))) matches.push(candidate);
    }
    if (matches.length === 0) throw new Error(`Run not found: ${runId}`);
    if (matches.length > 1) throw new Error(`Run ID is ambiguous; pass --session: ${runId}`);
    return { sessionId: matches[0], run: this.readRun(matches[0], runId) };
  }

  /** Enumerate canonical Session files only; state.json is never consulted. */
  listSessions(filters: SessionListFilters = {}): SessionListResult {
    return this.withLock(() => {
      const candidates: SessionListCandidate[] = [];
      const exclusions: SessionListExclusion[] = [];
      if (!existsSync(this.sessionsRoot)) return { candidates, exclusions };
      for (const sessionId of readdirSync(this.sessionsRoot).sort()) {
        const path = join(this.sessionsRoot, sessionId);
        try {
          if (!statSync(path).isDirectory() || !existsSync(join(path, 'session.json'))) continue;
          const session = this.readBundleUnlocked(sessionId).session;
          if (filters.statuses && !filters.statuses.includes(session.status)) {
            exclusions.push({ sessionId, code: 'STATUS_FILTERED', detail: session.status });
            continue;
          }
          if (filters.engines && !filters.engines.includes(session.orchestration.engine)) {
            exclusions.push({ sessionId, code: 'ENGINE_FILTERED', detail: session.orchestration.engine });
            continue;
          }
          let identity = session.intent_identity;
          if (!identity && filters.intentIdentity) {
            identity = createIntentIdentity(
              this.projectRoot,
              filters.intentIdentity.command,
              session.intent,
              { source: 'derived_legacy', backfillStatus: 'derived' },
            );
          }
          if (filters.intentIdentity) {
            if (!identity) {
              exclusions.push({ sessionId, code: 'IDENTITY_UNAVAILABLE', detail: 'no native or derivable identity' });
              continue;
            }
            if (!sameIntentIdentity(identity, filters.intentIdentity)) {
              exclusions.push({ sessionId, code: 'IDENTITY_MISMATCH', detail: identity.normalized_hash });
              continue;
            }
          }
          candidates.push({ sessionId, session: clone(session), identity: identity ? clone(identity) : null });
        } catch (error) {
          exclusions.push({
            sessionId,
            code: 'CORRUPT',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { candidates, exclusions };
    });
  }

  issueRecallConfirmation(input: IssueRecallConfirmationInput): { token: string; record: RecallConfirmationRecord } {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const issued = issueRecallConfirmationRecord(input);
      if (registry.records[issued.record.token_hash]) throw new Error('recall confirmation token hash collision');
      registry.records[issued.record.token_hash] = issued.record;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(),
        value: registry,
        schema: recallConfirmationRegistrySchema,
      }]);
      return { token: issued.token, record: clone(issued.record) };
    });
  }

  readRecallConfirmation(token: string): RecallConfirmationRecord | null {
    return this.withLock(() => {
      const record = this.readRecallRegistryUnlocked().records[hashRecallConfirmationToken(token)];
      return record ? clone(record) : null;
    });
  }

  reserveRecallConfirmation(
    token: string,
    input: ReserveRecallConfirmationInput,
  ): SessionStoreReserveRecallResult {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const tokenHash = hashRecallConfirmationToken(token);
      const current = registry.records[tokenHash];
      if (!current) throw new RecallConfirmationError('TOKEN_INVALID', 'confirmation token not found');
      const result = reserveRecallConfirmationRecord(current, input);
      if (result.status !== 'reserved') return clone({ ...result, validated_source: null });
      const validatedSource = this.validateRecallSourceFenceUnlocked(input.action, input.source_fence);
      this.assertRecallTargetFenceUnlocked(input.target_fence);
      if (this.findRecallReservationUnlocked(registry, result.reservation_id)) {
        throw new Error('recall confirmation reservation ID collision');
      }
      registry.records[tokenHash] = result.record;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(),
        value: registry,
        schema: recallConfirmationRegistrySchema,
      }]);
      return clone({ ...result, validated_source: validatedSource });
    });
  }

  validateRecallConfirmationSource(
    action: RecallConfirmationRecord['action'],
    sourceFence: RecallConfirmationRecord['source_fence'],
  ): ValidatedRecallSource | null {
    return this.withLock(() => this.validateRecallSourceFenceUnlocked(action, sourceFence));
  }

  claimRecallConfirmationTarget(
    reservationId: string,
    now = new Date(),
  ): { reservation_id: string; marker: RecallReservationMarker; marker_path: string } {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId);
      if (!located?.record.reservation) {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
      }
      const reservation = located.record.reservation;
      if (!['reserved', 'target-claimed'].includes(reservation.phase) || Date.parse(reservation.expires_at) <= now.getTime()) {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation cannot claim a target');
      }
      if (reservation.phase === 'target-claimed') {
        const marker = this.assertRecallReservationMarkerUnlocked(reservation);
        return {
          reservation_id: reservationId,
          marker: clone(marker),
          marker_path: this.recallReservationMarkerPath(reservation.proposed_target.session_id),
        };
      }
      this.assertRecallTargetFenceUnlocked(reservation.target_fence);
      const marker = createRecallReservationMarker(reservation);
      const markerPath = this.recallReservationMarkerPath(reservation.proposed_target.session_id);
      if (existsSync(markerPath)) {
        const existing = this.readValidated(markerPath, recallReservationMarkerSchema);
        if (stableJsonUtf8(existing) !== stableJsonUtf8(marker)) {
          throw new RecallConfirmationError('FENCE_CONFLICT', 'target reservation marker belongs to another reservation');
        }
      } else {
        const targetDir = this.sessionDir(reservation.proposed_target.session_id);
        if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
          throw new RecallConfirmationError('FENCE_CONFLICT', 'target directory exists without the reservation marker');
        }
        mkdirSync(targetDir, { recursive: true });
      }
      const claimed = recallConfirmationRecordSchema.parse({
        ...located.record,
        reservation: { ...reservation, phase: 'target-claimed' },
      });
      registry.records[located.tokenHash] = claimed;
      registry.revision++;
      this.writeBatchUnlocked([
        { path: markerPath, value: marker, schema: recallReservationMarkerSchema },
        { path: this.recallRegistryPath(), value: registry, schema: recallConfirmationRegistrySchema },
      ]);
      return { reservation_id: reservationId, marker: clone(marker), marker_path: markerPath };
    });
  }

  readRecallTargetHash(target: RecallConfirmationFinalTarget): string {
    return this.withLock(() => this.recallTargetHashUnlocked(target));
  }

  finalizeRecallConfirmation(
    reservationId: string,
    input: FinalizeRecallConfirmationInput,
  ): { outcome: RecallConfirmationOutcome; replayed: boolean } {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId, true);
      if (!located) throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
      if (!located.record.outcome) {
        this.validateRecallSourceFenceUnlocked(located.record.action, located.record.source_fence);
        if (located.record.reservation && ['target-claimed', 'resume-finalize'].includes(located.record.reservation.phase)) {
          this.assertRecallReservationMarkerUnlocked(located.record.reservation);
        }
        const actualTargetHash = this.recallTargetHashUnlocked(input.target);
        if (actualTargetHash !== input.target_hash) {
          throw new RecallConfirmationError('FENCE_CONFLICT', 'final target authority hash changed');
        }
      }
      const finalized = finalizeRecallConfirmationRecord(located.record, reservationId, input);
      if (finalized.replayed) return { outcome: clone(finalized.outcome), replayed: true };
      registry.records[located.tokenHash] = finalized.record;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(),
        value: registry,
        schema: recallConfirmationRegistrySchema,
      }]);
      const markerPath = this.recallReservationMarkerPath(finalized.outcome.target.session_id);
      if (existsSync(markerPath)) {
        try {
          const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { reservation_id?: unknown };
          if (marker.reservation_id === reservationId) rmSync(markerPath, { force: true });
        } catch { /* finalized authority is durable; an unrelated marker is left untouched */ }
      }
      return { outcome: clone(finalized.outcome), replayed: false };
    });
  }

  cancelRecallConfirmation(
    reservationId: string,
    now = new Date(),
  ): { reservation_id: string; rollback_target: RecallConfirmationTargetIdentity; released: boolean } {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId);
      if (!located) throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
      if (located.record.reservation?.phase === 'target-claimed') {
        this.assertRecallReservationMarkerUnlocked(located.record.reservation);
      }
      const cancelled = cancelRecallConfirmationRecord(located.record, reservationId, now);
      registry.records[located.tokenHash] = cancelled.record;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(),
        value: registry,
        schema: recallConfirmationRegistrySchema,
      }]);
      return {
        reservation_id: reservationId,
        rollback_target: clone(cancelled.rollback_target),
        released: cancelled.released,
      };
    });
  }

  observeRecallConfirmationReservation(
    reservationId: string,
    observedAt = new Date(),
  ): RecallReservationObservation {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId);
      if (!located?.record.reservation) {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
      }
      return this.observeRecallReservationUnlocked(located.record.reservation, observedAt);
    });
  }

  reconcileExpiredRecallConfirmation(
    reservationId: string,
    reportedInput: RecallReservationObservation,
    now = new Date(),
  ): RecallReservationReconciliation {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId);
      if (!located?.record.reservation) {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
      }
      const reservation = located.record.reservation;
      if (Date.parse(reservation.expires_at) > now.getTime() && reservation.phase !== 'rollback-partial') {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation is not expired');
      }
      const reported = recallReservationObservationSchema.parse(reportedInput);
      if (reported.reservation_id !== reservationId) {
        throw new RecallConfirmationError('REQUEST_CONFLICT', 'reconciliation observation reservation mismatch');
      }
      const actual = this.observeRecallReservationUnlocked(reservation, new Date(reported.observed_at));
      const stale = createStaleRecallReservation(reservation);
      let decision: RecallReservationReconciliation['decision'] = 'conflict';
      let reason = 'reported marker or target authority does not match canonical observation';
      let reconcileExpiresAt: string | null = null;
      if (stableJsonUtf8(reported) === stableJsonUtf8(actual)) {
        const identityMatches = actual.target.intent_identity !== null
          && sameIntentIdentity(actual.target.intent_identity, reservation.proposed_target.intent_identity);
        if (actual.marker.state === 'matching' && actual.target.state === 'complete' && identityMatches) {
          try {
            this.validateRecallSourceFenceUnlocked(reservation.action, reservation.source_fence);
            decision = 'resume_finalize';
            reason = 'matching reservation marker and complete target authority can resume finalize';
            reconcileExpiresAt = new Date(now.getTime() + RECALL_CONFIRMATION_RECONCILIATION_TTL_MS).toISOString();
          } catch {
            decision = 'conflict';
            reason = 'source authority fence changed during reconciliation';
          }
        } else if (
          (actual.marker.state === 'matching' && actual.target.state === 'partial')
          || (actual.marker.state === 'missing' && actual.target.state === 'absent')
        ) {
          decision = 'rollback_partial';
          reason = actual.target.state === 'absent'
            ? 'no target authority exists; stale reservation may be released after confirmation'
            : 'matching reservation marker bounds rollback to the stale partial target';
        } else if (actual.target.state === 'complete' && !identityMatches) {
          reason = 'complete target belongs to a different intent identity';
        } else if (actual.marker.state === 'mismatched') {
          reason = 'target marker belongs to a different reservation';
        } else {
          reason = 'target authority is not safely attributable to the stale reservation';
        }
      }
      const phase = decision === 'resume_finalize'
        ? 'resume-finalize'
        : decision === 'rollback_partial' ? 'rollback-partial' : 'conflict';
      const updated = recallConfirmationRecordSchema.parse({
        ...located.record,
        reservation: { ...reservation, phase, reconcile_expires_at: reconcileExpiresAt },
      });
      registry.records[located.tokenHash] = updated;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(), value: registry, schema: recallConfirmationRegistrySchema,
      }]);
      return recallReservationReconciliationSchema.parse({
        schema_version: 'recall-reservation-reconciliation/1.0',
        reservation_id: reservationId,
        decision,
        reason,
        stale,
        observed: actual,
        reconcile_expires_at: reconcileExpiresAt,
      });
    });
  }

  completeRecallConfirmationRollback(
    reservationId: string,
    reportedInput: RecallReservationObservation,
  ): { reservation_id: string; rollback_target: RecallConfirmationTargetIdentity; released: true } {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const located = this.findRecallReservationUnlocked(registry, reservationId);
      if (!located?.record.reservation || located.record.reservation.phase !== 'rollback-partial') {
        throw new RecallConfirmationError('RESERVATION_INVALID', 'rollback reconciliation is not authorized');
      }
      const reservation = located.record.reservation;
      const reported = recallReservationObservationSchema.parse(reportedInput);
      const actual = this.observeRecallReservationUnlocked(reservation, new Date(reported.observed_at));
      if (stableJsonUtf8(reported) !== stableJsonUtf8(actual)) {
        throw new RecallConfirmationError('FENCE_CONFLICT', 'rollback observation does not match canonical target authority');
      }
      if (actual.marker.state !== 'missing' || actual.target.state !== 'absent') {
        throw new RecallConfirmationError('FENCE_CONFLICT', 'rollback target or reservation marker still exists');
      }
      registry.records[located.tokenHash] = recallConfirmationRecordSchema.parse({
        ...located.record,
        reservation: null,
      });
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(), value: registry, schema: recallConfirmationRegistrySchema,
      }]);
      return {
        reservation_id: reservationId,
        rollback_target: clone(reservation.proposed_target),
        released: true,
      };
    });
  }

  consumeRecallConfirmation(
    token: string,
    expected: { action: RecallConfirmationRecord['action']; request_hash: string; now?: Date },
    result: { session_id: string; run_id?: string | null },
  ): RecallConfirmationRecord {
    return this.withLock(() => {
      const registry = this.readRecallRegistryUnlocked();
      const tokenHash = hashRecallConfirmationToken(token);
      const current = registry.records[tokenHash];
      if (!current) throw new RecallConfirmationError('TOKEN_INVALID', 'confirmation token not found');
      const record = assertRecallConfirmationConsumable(current, expected);
      const consumed = {
        ...record,
        consumed_at: (expected.now ?? new Date()).toISOString(),
        result_session_id: result.session_id,
        result_run_id: result.run_id ?? null,
        reservation: null,
      };
      registry.records[tokenHash] = consumed;
      registry.revision++;
      this.writeBatchUnlocked([{
        path: this.recallRegistryPath(),
        value: registry,
        schema: recallConfirmationRegistrySchema,
      }]);
      return clone(consumed);
    });
  }

  readSessionFence(sessionId: string, runId?: string | null): TransitionFence {
    return this.withLock(() => this.sessionFenceUnlocked(sessionId, runId));
  }

  validateSourceTargetFences(input: {
    source: { session_id: string; run_id?: string | null; fence: TransitionFence };
    target?: { session_id: string; run_id?: string | null; fence: TransitionFence };
  }): { source: TransitionFence; target: TransitionFence | null } {
    return this.withLock(() => {
      const source = this.sessionFenceUnlocked(input.source.session_id, input.source.run_id);
      if (JSON.stringify(source) !== JSON.stringify(transitionFenceSchema.parse(input.source.fence))) {
        throw new Error('source authority fence changed');
      }
      const target = input.target
        ? this.sessionFenceUnlocked(input.target.session_id, input.target.run_id)
        : null;
      if (target && input.target && JSON.stringify(target) !== JSON.stringify(transitionFenceSchema.parse(input.target.fence))) {
        throw new Error('target authority fence changed');
      }
      return { source, target };
    });
  }

  replayOrApplyTransition(
    sessionId: string,
    request: TransitionRequest,
    apply: (draft: SessionBundle, tx: StoreTransaction) => TransitionOutcome,
  ): { outcome: TransitionOutcome; replayed: boolean } {
    return this.withLock(() => {
      const current = this.readBundleUnlocked(sessionId);
      const currentFence = this.sessionFenceForBundle(current, request.subject.run_id);
      const records = current.session.requests
        .filter(item => item.type === 'transition' && 'outcome' in item)
        .map(item => item as Extract<SessionState['requests'][number], { type: 'transition' }>);
      const draft = clone(current);
      const tx = new StoreTransaction(this, sessionId);
      const evaluated = replayOrApplyTransition(records, request, currentFence, () => apply(draft, tx));
      if (evaluated.replayed) return { outcome: clone(evaluated.outcome), replayed: true };
      const actualPost = this.sessionFenceForBundle(draft, request.subject.run_id, tx);
      if (JSON.stringify(actualPost) !== JSON.stringify(evaluated.outcome.postconditions)) {
        throw new Error(`transition ${evaluated.outcome.transition_id} postcondition fence does not match the draft`);
      }
      draft.session.requests.push(evaluated.record);
      draft.session.schema_version = 'session/1.3';
      sessionStateV13Schema.parse(draft.session);
      tx.addBundle(draft);
      this.writeBatchUnlocked(tx.writes);
      return { outcome: clone(evaluated.outcome), replayed: false };
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  readJsonFile<T>(path: string, schema: z.ZodType<T>, fallback?: T): T {
    if (!this.lock.isHeld) return this.withLock(() => this.readJsonFileUnlocked(path, schema, fallback));
    return this.readJsonFileUnlocked(path, schema, fallback);
  }

  private readJsonFileUnlocked<T>(path: string, schema: z.ZodType<T>, fallback?: T): T {
    const safePath = this.assertWorkflowPath(path);
    if (!existsSync(safePath)) {
      if (fallback === undefined) throw new Error(`Missing authoritative file: ${safePath}`);
      return clone(schema.parse(fallback));
    }
    return this.readValidated(safePath, schema);
  }

  updateJsonFile<T>(
    path: string,
    schema: z.ZodType<T>,
    initial: T,
    mutator: (draft: T) => void,
  ): T {
    const safePath = this.assertWorkflowPath(path);
    return this.withLock(() => {
      const current = existsSync(safePath) ? this.readValidated(safePath, schema) : schema.parse(initial);
      const draft = clone(current);
      mutator(draft);
      schema.parse(draft);
      this.writeBatchUnlocked([{ path: safePath, value: draft, schema }]);
      return clone(draft);
    });
  }

  appendLine(path: string, line: string): void {
    const safePath = this.assertWorkflowPath(path);
    this.withLock(() => {
      mkdirSync(dirname(safePath), { recursive: true });
      appendFileSync(safePath, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
    });
  }

  private recallRegistryPath(): string {
    return join(this.sessionsRoot, 'recall-confirmations.json');
  }

  private readRecallRegistryUnlocked(): RecallConfirmationRegistry {
    const path = this.recallRegistryPath();
    return existsSync(path)
      ? this.readValidated(path, recallConfirmationRegistrySchema)
      : createRecallConfirmationRegistry();
  }

  private findRecallReservationUnlocked(
    registry: RecallConfirmationRegistry,
    reservationId: string,
    includeFinalized = false,
  ): { tokenHash: string; record: RecallConfirmationRecord } | null {
    let match: { tokenHash: string; record: RecallConfirmationRecord } | null = null;
    for (const [tokenHash, record] of Object.entries(registry.records)) {
      const matchesActive = record.reservation?.reservation_id === reservationId;
      const matchesFinalized = includeFinalized && record.outcome?.reservation_id === reservationId;
      if (!matchesActive && !matchesFinalized) continue;
      if (match) throw new Error(`duplicate recall confirmation reservation ID: ${reservationId}`);
      match = { tokenHash, record };
    }
    return match;
  }

  private recallReservationMarkerPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), '.recall-reservation.json');
  }

  private assertRecallReservationMarkerUnlocked(
    reservation: NonNullable<RecallConfirmationRecord['reservation']>,
  ): RecallReservationMarker {
    const path = this.recallReservationMarkerPath(reservation.proposed_target.session_id);
    if (!existsSync(path)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'target reservation marker is missing');
    }
    const actual = this.readValidated(path, recallReservationMarkerSchema);
    const expected = createRecallReservationMarker(reservation);
    if (stableJsonUtf8(actual) !== stableJsonUtf8(expected)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'target reservation marker changed');
    }
    return actual;
  }

  private observeRecallReservationUnlocked(
    reservation: NonNullable<RecallConfirmationRecord['reservation']>,
    observedAt: Date,
  ): RecallReservationObservation {
    const targetDir = this.sessionDir(reservation.proposed_target.session_id);
    const markerPath = this.recallReservationMarkerPath(reservation.proposed_target.session_id);
    let marker: RecallReservationObservation['marker'] = { state: 'missing', reservation_id: null };
    if (existsSync(markerPath)) {
      try {
        const parsed = this.readValidated(markerPath, recallReservationMarkerSchema);
        const expected = createRecallReservationMarker(reservation);
        marker = stableJsonUtf8(parsed) === stableJsonUtf8(expected)
          ? { state: 'matching', reservation_id: parsed.reservation_id }
          : { state: 'mismatched', reservation_id: parsed.reservation_id };
      } catch {
        marker = { state: 'mismatched', reservation_id: null };
      }
    }
    let target: RecallReservationObservation['target'];
    if (!existsSync(targetDir)) {
      target = { state: 'absent', authority_hash: null, intent_identity: null, run_id: null };
    } else if (!existsSync(join(targetDir, 'session.json'))) {
      try {
        target = {
          state: 'partial',
          authority_hash: this.hashRecallTargetDirectoryUnlocked(targetDir),
          intent_identity: null,
          run_id: null,
        };
      } catch {
        target = { state: 'corrupt', authority_hash: null, intent_identity: null, run_id: null };
      }
    } else {
      try {
        const bundle = this.readBundleUnlocked(reservation.proposed_target.session_id);
        const runId = bundle.session.active_run_id;
        target = {
          state: 'complete',
          authority_hash: this.recallTargetAuthorityHashUnlocked(reservation.proposed_target.session_id, runId),
          intent_identity: bundle.session.intent_identity,
          run_id: runId,
        };
      } catch {
        target = { state: 'corrupt', authority_hash: null, intent_identity: null, run_id: null };
      }
    }
    return recallReservationObservationSchema.parse({
      schema_version: 'recall-reservation-observation/1.0',
      reservation_id: reservation.reservation_id,
      observed_at: observedAt.toISOString(),
      marker,
      target,
    });
  }

  private hashRecallTargetDirectoryUnlocked(targetDir: string): string {
    const entries: Array<{ path: string; size: number; hash: string | null; type: 'file' | 'directory' }> = [];
    let totalBytes = 0;
    const walk = (directory: string, prefix: string): void => {
      for (const name of readdirSync(directory).sort()) {
        if (entries.length >= 256) throw new Error('partial target snapshot exceeds 256 entries');
        const absolute = this.assertWorkflowPath(join(directory, name));
        const relativePath = prefix ? `${prefix}/${name}` : name;
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) throw new Error('partial target contains a symbolic link');
        if (stat.isDirectory()) {
          entries.push({ path: relativePath, size: 0, hash: null, type: 'directory' });
          walk(absolute, relativePath);
        } else if (stat.isFile()) {
          totalBytes += stat.size;
          if (totalBytes > 8 * 1024 * 1024) throw new Error('partial target snapshot exceeds 8 MiB');
          entries.push({ path: relativePath, size: stat.size, hash: sha256Prefixed(readFileSync(absolute)), type: 'file' });
        } else {
          throw new Error('partial target contains an unsupported entry');
        }
      }
    };
    walk(targetDir, '');
    return sha256Prefixed(stableJsonUtf8(entries));
  }

  private validateRecallSourceFenceUnlocked(
    action: RecallConfirmationRecord['action'],
    source: RecallConfirmationRecord['source_fence'],
  ): ValidatedRecallSource | null {
    if (!source) {
      if (action === 'fork' || action === 'import') {
        throw new RecallConfirmationError('FENCE_CONFLICT', `${action} requires a validated source fence`);
      }
      return null;
    }
    let scope: ValidatedRecallSource['scope'] = 'local';
    let sourceProjectRoot = this.projectRoot;
    if (source.workspace_link_name) {
      if (action !== 'import') {
        throw new RecallConfirmationError('FENCE_CONFLICT', 'linked workspace sources are import-only');
      }
      const matches = resolveWorkspaceLinks(this.projectRoot, loadWorkspaceConfig(this.projectRoot))
        .filter(link => link.valid
          && link.name === source.workspace_link_name
          && (link.share as string[]).includes('session'));
      if (matches.length !== 1) {
        throw new RecallConfirmationError('FENCE_CONFLICT', 'linked workspace source is unavailable or not uniquely shared');
      }
      sourceProjectRoot = matches[0].resolvedPath;
      scope = 'linked';
    }
    if (canonicalWorkspaceId(sourceProjectRoot) !== source.workspace_id) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'source workspace identity changed');
    }
    const sourceStore = resolve(sourceProjectRoot) === resolve(this.projectRoot)
      ? this
      : new SessionStore(sourceProjectRoot);
    const validate = () => sourceStore.validateSourceFenceAtRootUnlocked(source);
    const validated = sourceStore === this ? validate() : sourceStore.withLock(validate);
    return validatedRecallSourceSchema.parse({
      schema_version: 'validated-recall-source/1.0',
      scope,
      workspace_link_name: source.workspace_link_name,
      source_project_root: resolve(sourceProjectRoot),
      source_workflow_root: join(resolve(sourceProjectRoot), '.workflow'),
      workspace_id: source.workspace_id,
      session_id: source.session_id,
      run_id: source.run_id,
      session_status: validated.session_status,
      run_status: 'sealed',
      session_intent_identity: validated.session_intent_identity,
      fence: validated.fence,
    });
  }

  private validateSourceFenceAtRootUnlocked(
    source: NonNullable<RecallConfirmationRecord['source_fence']>,
  ): {
    fence: NonNullable<RecallConfirmationRecord['source_fence']>;
    session_status: 'sealed' | 'archived';
    session_intent_identity: IntentIdentity | null;
  } {
    const sessionPath = join(this.sessionDir(source.session_id), 'session.json');
    const runPath = join(this.runDir(source.session_id, source.run_id), 'run.json');
    if (!existsSync(sessionPath) || !existsSync(runPath)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'source authority fence changed');
    }
    const sessionRaw = readFileSync(sessionPath);
    const runRaw = readFileSync(runPath);
    const bundle = this.readBundleUnlocked(source.session_id);
    const run = this.readRunUnlocked(source.session_id, source.run_id);
    if (!['sealed', 'archived'].includes(bundle.session.status) || run.status !== 'sealed') {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'source Session and Run must remain sealed and immutable');
    }
    const selectedArtifacts = source.selected_artifacts.map(expected => {
      const registered = Object.values(bundle.artifacts.artifacts).find(item => (
        item.kind === expected.kind
        && item.relative_path === expected.relative_path
        && `sha256:${item.content_hash}` === expected.content_hash
        && item.status === 'sealed'
      ));
      if (!registered) throw new RecallConfirmationError('FENCE_CONFLICT', 'source artifact fence changed');
      const artifactPath = this.assertWorkflowPath(join(this.sessionDir(source.session_id), expected.relative_path));
      if (!existsSync(artifactPath)) throw new RecallConfirmationError('FENCE_CONFLICT', 'source artifact is missing');
      if (statSync(artifactPath).isFile() && sha256Prefixed(readFileSync(artifactPath)) !== expected.content_hash) {
        throw new RecallConfirmationError('FENCE_CONFLICT', 'source artifact content hash changed');
      }
      return expected;
    });
    const current = {
      workspace_id: canonicalWorkspaceId(this.projectRoot),
      workspace_link_name: source.workspace_link_name,
      session_id: source.session_id,
      session_schema_version: bundle.session.schema_version,
      session_identity_revision: bundle.session.identity_revision,
      session_activity_revision: bundle.session.activity_revision,
      session_hash: sha256Prefixed(sessionRaw),
      run_id: source.run_id,
      run_schema_version: run.schema_version,
      run_hash: sha256Prefixed(runRaw),
      artifact_registry_revision: bundle.artifacts.revision,
      selected_artifacts: selectedArtifacts,
    } as const;
    if (stableJsonUtf8(current) !== stableJsonUtf8(source)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'source authority fence changed');
    }
    return {
      fence: source,
      session_status: bundle.session.status as 'sealed' | 'archived',
      session_intent_identity: bundle.session.intent_identity,
    };
  }

  private assertRecallTargetFenceUnlocked(target: RecallConfirmationRecord['target_fence']): void {
    if (target.workspace_id !== canonicalWorkspaceId(this.projectRoot)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'target workspace fence changed');
    }
    const exists = this.sessionExists(target.session_id);
    if (target.must_not_exist) {
      if (exists) throw new RecallConfirmationError('FENCE_CONFLICT', 'target Session already exists');
      return;
    }
    if (!exists) throw new RecallConfirmationError('FENCE_CONFLICT', 'target Session no longer exists');
    const bundle = this.readBundleUnlocked(target.session_id);
    const actual = {
      workspace_id: target.workspace_id,
      session_id: target.session_id,
      must_not_exist: false,
      status: bundle.session.status,
      identity_revision: bundle.session.identity_revision,
      activity_revision: bundle.session.activity_revision,
      active_run_id: bundle.session.active_run_id,
      artifact_registry_revision: bundle.artifacts.revision,
    };
    if (stableJsonUtf8(actual) !== stableJsonUtf8(target)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'target authority fence changed');
    }
  }

  private recallTargetHashUnlocked(targetInput: RecallConfirmationFinalTarget): string {
    const target = recallConfirmationFinalTargetSchema.parse(targetInput);
    if (target.workspace_id !== canonicalWorkspaceId(this.projectRoot)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'final target workspace does not match');
    }
    const bundle = this.readBundleUnlocked(target.session_id);
    if (!bundle.session.intent_identity || !sameIntentIdentity(bundle.session.intent_identity, target.intent_identity)) {
      throw new RecallConfirmationError('FENCE_CONFLICT', 'final target intent identity does not match');
    }
    return this.recallTargetAuthorityHashUnlocked(target.session_id, target.run_id);
  }

  private recallTargetAuthorityHashUnlocked(sessionId: string, runId: string | null): string {
    const bundle = this.readBundleUnlocked(sessionId);
    const run = runId ? this.readRunUnlocked(sessionId, runId) : null;
    return sha256Prefixed(stableJsonUtf8({
      session: bundle.session,
      run,
      gates: bundle.gates,
      artifacts: bundle.artifacts,
      evidence: bundle.evidence,
    }));
  }

  private sessionFenceUnlocked(sessionId: string, runId?: string | null): TransitionFence {
    return this.sessionFenceForBundle(this.readBundleUnlocked(sessionId), runId);
  }

  private sessionFenceForBundle(
    bundle: SessionBundle,
    runId?: string | null,
    tx?: StoreTransaction,
  ): TransitionFence {
    let runHash: string | null = null;
    if (runId) {
      const pending = tx?.writes.find(write => write.path === join(this.runDir(bundle.session.session_id, runId), 'run.json'));
      if (pending) runHash = sha256Prefixed(`${JSON.stringify(pending.value, null, 2)}\n`);
      else {
        const path = join(this.runDir(bundle.session.session_id, runId), 'run.json');
        if (existsSync(path)) runHash = sha256Prefixed(readFileSync(path));
      }
    }
    return transitionFenceSchema.parse({
      session_identity_revision: bundle.session.identity_revision,
      session_activity_revision: bundle.session.activity_revision,
      active_run_id: bundle.session.active_run_id,
      run_hash: runHash,
      artifact_registry_revision: bundle.artifacts.revision,
    });
  }

  private transactionIntentPath(): string {
    return join(this.sessionsRoot, TRANSACTION_INTENT_FILE);
  }

  private reconcileTransactionIntentUnlocked(): void {
    const intentPath = this.transactionIntentPath();
    if (!existsSync(intentPath)) return;
    let intent: TransactionIntent;
    try {
      intent = transactionIntentSchema.parse(JSON.parse(readFileSync(intentPath, 'utf8')));
    } catch (error) {
      throw new Error(`SessionStore recovery required: invalid transaction intent at ${intentPath}: ${(error as Error).message}`);
    }
    try {
      for (const entry of intent.writes) {
        const path = this.assertWorkflowPath(join(this.workflowRoot, entry.path));
        const tmpPath = this.assertWorkflowPath(join(this.workflowRoot, entry.tmp_path));
        const current = existsSync(path) ? readFileSync(path) : null;
        const currentHash = current ? sha256Hex(current) : null;
        if (currentHash !== entry.original_sha256) {
          if (entry.original_base64 === null) {
            rmSync(path, { force: true });
          } else {
            const recoveryTmp = `${path}.recovery-${intent.transaction_id}`;
            writeFileSync(recoveryTmp, Buffer.from(entry.original_base64, 'base64'));
            safeRename(recoveryTmp, path);
          }
        }
        rmSync(tmpPath, { force: true });
      }
      rmSync(intentPath, { force: true });
      this.clearCache();
    } catch (error) {
      throw new Error(`SessionStore recovery required for ${intent.transaction_id}: ${(error as Error).message}`);
    }
  }

  private assertWorkflowPath(path: string): string {
    const root = resolve(this.workflowRoot);
    const target = resolve(path);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes .workflow: ${path}`);
    return target;
  }

  private readValidated<T>(path: string, schema: z.ZodType<T>): T {
    if (!existsSync(path)) throw new Error(`Missing authoritative file: ${path}`);
    const stat = statSync(path);
    const cached = this.cache.get(path);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return clone(cached.data as T);
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
      throw new Error(`Invalid JSON at ${path}: ${(error as Error).message}`);
    }
    const data = schema.parse(parsed);
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(path, { mtime: stat.mtimeMs, size: stat.size, data: clone(data) });
    return data;
  }

  private writeBundleUnlocked(sessionId: string, bundle: SessionBundle): void {
    const dir = this.sessionDir(sessionId);
    this.writeBatchUnlocked([
      { path: join(dir, 'session.json'), value: bundle.session, schema: sessionStateV13Schema },
      { path: join(dir, 'gates.json'), value: bundle.gates, schema: gateRegistrySchema },
      { path: join(dir, 'artifacts.json'), value: bundle.artifacts, schema: artifactRegistrySchema },
      { path: join(dir, 'evidence.json'), value: bundle.evidence, schema: evidenceStoreSchema },
    ]);
  }

  private writeBatchUnlocked(writes: JsonWrite[]): void {
    const unique = new Map(writes.map(write => [write.path, write]));
    const entries = [...unique.values()];
    for (const entry of entries) entry.schema?.parse(entry.value);

    const originals = new Map<string, Buffer | null>();
    const staged: Array<{ tmp: string; path: string; content: string }> = [];
    let intentWritten = false;
    try {
      for (const entry of entries) {
        mkdirSync(dirname(entry.path), { recursive: true });
        originals.set(entry.path, existsSync(entry.path) ? readFileSync(entry.path) : null);
        const tmp = `${entry.path}.tmp-${process.pid}-${Date.now()}-${staged.length}`;
        staged.push({ tmp, path: entry.path, content: `${JSON.stringify(entry.value, null, 2)}\n` });
      }
      const transactionId = `tx_${randomUUID()}`;
      const intent = transactionIntentSchema.parse({
        schema_version: 'session-store-intent/1.0',
        transaction_id: transactionId,
        created_at: new Date().toISOString(),
        writes: staged.map(item => {
          const original = originals.get(item.path) ?? null;
          return {
            path: relative(this.workflowRoot, item.path).replaceAll('\\', '/'),
            tmp_path: relative(this.workflowRoot, item.tmp).replaceAll('\\', '/'),
            original_base64: original?.toString('base64') ?? null,
            original_sha256: original ? sha256Hex(original) : null,
            next_sha256: sha256Hex(item.content),
          };
        }),
      });
      mkdirSync(this.sessionsRoot, { recursive: true });
      writeFileSync(this.transactionIntentPath(), `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
      intentWritten = true;
      for (const item of staged) {
        if (existsSync(item.path)) this.backup(item.path);
        writeFileSync(item.tmp, item.content, 'utf8');
      }
      for (const item of staged) safeRename(item.tmp, item.path);
      rmSync(this.transactionIntentPath(), { force: true });
      this.clearCache();
    } catch (error) {
      if (intentWritten) {
        try {
          this.reconcileTransactionIntentUnlocked();
        } catch (recoveryError) {
          this.clearCache();
          throw new Error(
            `SessionStore transaction failed and recovery is required: ${(error as Error).message}; `
            + `${(recoveryError as Error).message}`,
          );
        }
      } else {
        for (const item of staged) {
          try { rmSync(item.tmp, { force: true }); } catch { /* ignore */ }
        }
      }
      this.clearCache();
      throw error;
    }
  }

  private backup(path: string): void {
    const backupDir = join(dirname(path), '.backups');
    mkdirSync(backupDir, { recursive: true });
    const base = basename(path).replace(/\.json$/i, '');
    const backupPath = join(backupDir, `${base}-${timestamp()}-${process.pid}-${Date.now()}.json`);
    copyFileSync(path, backupPath);
    const backups = readdirSync(backupDir)
      .filter(name => name.startsWith(`${base}-`))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { unlinkSync(join(backupDir, old)); } catch { /* ignore */ }
    }
  }
}

export class StoreTransaction {
  readonly writes: JsonWrite[] = [];

  constructor(private readonly store: SessionStore, private readonly sessionId: string) {}

  readRun(runId: string): CommandRun {
    return this.store.readRun(this.sessionId, runId);
  }

  writeRun(run: CommandRun): void {
    commandRunV13Schema.parse(run);
    this.writes.push({
      path: join(this.store.runDir(this.sessionId, run.run_id), 'run.json'),
      value: run,
      schema: commandRunV13Schema,
    });
  }

  writeJson(path: string, value: unknown, schema?: z.ZodType): void {
    this.writes.push({ path, value, schema });
  }

  addBundle(bundle: SessionBundle): void {
    const dir = this.store.sessionDir(this.sessionId);
    this.writes.push(
      { path: join(dir, 'session.json'), value: bundle.session, schema: sessionStateV13Schema },
      { path: join(dir, 'gates.json'), value: bundle.gates, schema: gateRegistrySchema },
      { path: join(dir, 'artifacts.json'), value: bundle.artifacts, schema: artifactRegistrySchema },
      { path: join(dir, 'evidence.json'), value: bundle.evidence, schema: evidenceStoreSchema },
    );
  }
}
