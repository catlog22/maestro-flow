import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { z } from 'zod';
import { safeRename } from '../utils/state-schema.js';
import {
  artifactRegistrySchema,
  commandRunSchema,
  evidenceStoreSchema,
  gateRegistrySchema,
  sessionStateSchema,
  type ArtifactRegistry,
  type CommandRun,
  type EvidenceStore,
  type GateRegistry,
  type SessionState,
} from './schemas.js';
import { createArtifactRegistry, createEvidenceStore, createGateRegistry, createSessionState } from './defaults.js';
import { assertSafePathSegment } from './ids.js';

const STALE_LOCK_MS = 30_000;
const MAX_BACKUPS = 10;
const CACHE_MAX_ENTRIES = 64;

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

interface JsonWrite {
  path: string;
  value: unknown;
  schema?: z.ZodType;
}

class SessionStoreLock {
  private readonly path: string;
  private held = false;

  constructor(path: string) {
    this.path = path;
  }

  acquire(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    try {
      writeFileSync(this.path, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }), { flag: 'wx' });
      this.held = true;
      return;
    } catch { /* inspect existing lock */ }

    let stale = true;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as { pid?: number; acquired_at?: number };
      const age = Date.now() - statSync(this.path).mtimeMs;
      stale = age >= STALE_LOCK_MS || !data.pid || !isProcessAlive(data.pid);
      if (!stale) throw new Error(`SessionStore locked by PID ${data.pid}: ${this.path}`);
    } catch (error) {
      if ((error as Error).message.startsWith('SessionStore locked by PID')) throw error;
    }
    if (stale) {
      try { unlinkSync(this.path); } catch { /* already removed */ }
    }
    try {
      writeFileSync(this.path, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }), { flag: 'wx' });
      this.held = true;
    } catch {
      throw new Error(`Cannot acquire SessionStore lock: ${this.path}`);
    }
  }

  release(): void {
    if (!this.held) return;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as { pid?: number };
      if (data.pid === process.pid) unlinkSync(this.path);
    } catch { /* already removed */ }
    this.held = false;
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.\-TZ]/g, '').slice(0, 14);
}

export class SessionStore {
  readonly projectRoot: string;
  readonly workflowRoot: string;
  readonly sessionsRoot: string;
  private readonly lock: SessionStoreLock;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.workflowRoot = join(projectRoot, '.workflow');
    this.sessionsRoot = join(this.workflowRoot, 'sessions');
    this.lock = new SessionStoreLock(join(this.sessionsRoot, '.session-store.lock'));
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
    try { return fn(); } finally { this.lock.release(); }
  }

  sessionExists(sessionId: string): boolean {
    return existsSync(join(this.sessionDir(sessionId), 'session.json'));
  }

  createSession(
    sessionId: string,
    intent: string,
    options: { ifExists?: 'reuse' | 'error' } = {},
  ): SessionBundle {
    return this.withLock(() => {
      if (this.sessionExists(sessionId)) {
        if (options.ifExists === 'error') throw new Error(`Session already exists: ${sessionId}`);
        return this.readBundle(sessionId);
      }
      const bundle: SessionBundle = {
        session: createSessionState(sessionId, intent),
        gates: createGateRegistry(),
        artifacts: createArtifactRegistry(),
        evidence: createEvidenceStore(),
      };
      const dir = this.sessionDir(sessionId);
      mkdirSync(join(dir, 'runs'), { recursive: true });
      mkdirSync(join(dir, 'specs'), { recursive: true });
      mkdirSync(join(dir, 'knowhow'), { recursive: true });
      writeFileSync(join(dir, 'events.ndjson'), '', { flag: 'a' });
      writeFileSync(join(dir, 'context.md'), `# ${intent}\n`, { flag: 'wx' });
      this.writeBundleUnlocked(sessionId, bundle);
      return clone(bundle);
    });
  }

  readBundle(sessionId: string): SessionBundle {
    const dir = this.sessionDir(sessionId);
    return {
      session: this.readValidated(join(dir, 'session.json'), sessionStateSchema),
      gates: this.readValidated(join(dir, 'gates.json'), gateRegistrySchema),
      artifacts: this.readValidated(join(dir, 'artifacts.json'), artifactRegistrySchema),
      evidence: this.readValidated(join(dir, 'evidence.json'), evidenceStoreSchema),
    };
  }

  readRun(sessionId: string, runId: string): CommandRun {
    return this.readValidated(join(this.runDir(sessionId, runId), 'run.json'), commandRunSchema);
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
      // Write-back always lands schema_version at session/1.1: a session/1.0 file
      // read into memory is upgraded (new fields already carry defaults) the moment
      // it is persisted. Reads stay lossless; only writes migrate the version tag.
      draft.session.schema_version = 'session/1.1';
      sessionStateSchema.parse(draft.session);
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

  clearCache(): void {
    this.cache.clear();
  }

  readJsonFile<T>(path: string, schema: z.ZodType<T>, fallback?: T): T {
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
      { path: join(dir, 'session.json'), value: bundle.session, schema: sessionStateSchema },
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
    const staged: Array<{ tmp: string; path: string }> = [];
    try {
      for (const entry of entries) {
        mkdirSync(dirname(entry.path), { recursive: true });
        originals.set(entry.path, existsSync(entry.path) ? readFileSync(entry.path) : null);
        if (existsSync(entry.path)) this.backup(entry.path);
        const tmp = `${entry.path}.tmp-${process.pid}-${Date.now()}-${staged.length}`;
        writeFileSync(tmp, `${JSON.stringify(entry.value, null, 2)}\n`, 'utf8');
        staged.push({ tmp, path: entry.path });
      }
      for (const item of staged) safeRename(item.tmp, item.path);
      this.clearCache();
    } catch (error) {
      for (const item of staged) {
        try { rmSync(item.tmp, { force: true }); } catch { /* ignore */ }
      }
      for (const [path, original] of originals) {
        try {
          if (original === null) rmSync(path, { force: true });
          else writeFileSync(path, original);
        } catch { /* best-effort rollback */ }
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
    commandRunSchema.parse(run);
    this.writes.push({
      path: join(this.store.runDir(this.sessionId, run.run_id), 'run.json'),
      value: run,
      schema: commandRunSchema,
    });
  }

  writeJson(path: string, value: unknown, schema?: z.ZodType): void {
    this.writes.push({ path, value, schema });
  }

  addBundle(bundle: SessionBundle): void {
    const dir = this.store.sessionDir(this.sessionId);
    this.writes.push(
      { path: join(dir, 'session.json'), value: bundle.session, schema: sessionStateSchema },
      { path: join(dir, 'gates.json'), value: bundle.gates, schema: gateRegistrySchema },
      { path: join(dir, 'artifacts.json'), value: bundle.artifacts, schema: artifactRegistrySchema },
      { path: join(dir, 'evidence.json'), value: bundle.evidence, schema: evidenceStoreSchema },
    );
  }
}
