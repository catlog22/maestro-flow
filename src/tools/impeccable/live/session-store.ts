/**
 * Durable live-session store backed by append-only JSONL journals.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLiveSessionsDir, getLegacyLiveSessionsDir } from '../paths.js';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type LiveEventType =
  | 'generate'
  | 'variants_ready'
  | 'agent_done'
  | 'checkpoint'
  | 'accept'
  | 'accept_intent'
  | 'discard'
  | 'discarded'
  | 'complete'
  | 'agent_error';

export interface LiveEvent {
  id?: string;
  type: LiveEventType | string;
  pageUrl?: string;
  count?: number;
  screenshotPath?: string;
  file?: string;
  arrivedVariants?: number;
  carbonize?: boolean;
  revision?: number;
  phase?: string;
  owner?: string;
  visibleVariant?: number;
  paramValues?: Record<string, unknown>;
  variantId?: number;
  message?: string;
  token?: string;
}

export interface JournalEntry {
  seq: number;
  id: string;
  type: string;
  ts: string;
  event: LiveEvent;
}

export interface AnnotationArtifact {
  type: string;
  path: string;
}

export interface DiagnosticEntry {
  error: string;
  line?: number;
  message?: string;
  type?: string;
  revision?: number;
  file?: string | null;
}

export interface LiveSnapshot {
  id: string;
  phase: string;
  pageUrl: string | null;
  sourceFile: string | null;
  expectedVariants: number;
  arrivedVariants: number;
  visibleVariant: number | null;
  paramValues: Record<string, unknown>;
  pendingEventSeq: number | null;
  pendingEvent: LiveEvent | null;
  deliveryLease: unknown | null;
  checkpointRevision: number;
  activeOwner: string | null;
  sourceMarkers: Record<string, unknown>;
  fallbackMode: string | null;
  annotationArtifacts: AnnotationArtifact[];
  diagnostics: DiagnosticEntry[];
  updatedAt: string | null;
}

interface CachedSnapshot {
  snapshot: LiveSnapshot;
  diagnostics: DiagnosticEntry[];
  nextSeq: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLETED_PHASES = new Set(['completed', 'discarded']);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface LiveSessionStore {
  rootDir: string;
  legacyRootDir: string;
  appendEvent(event: LiveEvent): LiveSnapshot;
  getSnapshot(id?: string, opts?: { includeCompleted?: boolean }): LiveSnapshot | null;
  listActiveSessions(): LiveSnapshot[];
}

export function createLiveSessionStore(opts: {
  cwd?: string;
  sessionId?: string;
} = {}): LiveSessionStore {
  const cwd = opts.cwd ?? process.cwd();
  const sessionId = opts.sessionId;
  const rootDir = getLiveSessionsDir(cwd);
  const legacyRootDir = getLegacyLiveSessionsDir(cwd);
  fs.mkdirSync(rootDir, { recursive: true });
  const snapshotCache = new Map<string, CachedSnapshot>();

  function loadCachedOrRebuild(id: string): CachedSnapshot {
    const cached = snapshotCache.get(id);
    if (cached) return cached;
    const journalPath = getReadableJournalPath(id);
    const rebuilt = rebuildSnapshotFromJournal(journalPath, id);
    snapshotCache.set(id, rebuilt);
    return rebuilt;
  }

  function getReadableJournalPath(id: string): string {
    const primary = getJournalPath(rootDir, id);
    if (fs.existsSync(primary)) return primary;
    const legacy = getJournalPath(legacyRootDir, id);
    if (fs.existsSync(legacy)) return legacy;
    return primary;
  }

  const store: LiveSessionStore = {
    rootDir,
    legacyRootDir,
    appendEvent(event: LiveEvent): LiveSnapshot {
      const normalized = normalizeEvent(event, sessionId);
      const journalPath = getJournalPath(rootDir, normalized.id!);
      const snapshotPath = getSnapshotPath(rootDir, normalized.id!);
      const legacyJournalPath = getJournalPath(legacyRootDir, normalized.id!);
      if (!fs.existsSync(journalPath) && fs.existsSync(legacyJournalPath)) {
        fs.copyFileSync(legacyJournalPath, journalPath);
      }
      const prior = loadCachedOrRebuild(normalized.id!);
      const seq = prior.nextSeq;
      const entry: JournalEntry = {
        seq,
        id: normalized.id!,
        type: normalized.type,
        ts: new Date().toISOString(),
        event: normalized,
      };
      fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n');
      const next = applyEvent(prior.snapshot, entry, prior.diagnostics);
      snapshotCache.set(normalized.id!, {
        snapshot: next,
        diagnostics: next.diagnostics || [],
        nextSeq: seq + 1,
      });
      writeSnapshot(snapshotPath, next);
      return next;
    },
    getSnapshot(id: string | undefined = sessionId, opts: { includeCompleted?: boolean } = {}): LiveSnapshot | null {
      if (!id) throw new Error('session id required');
      const journalPath = getReadableJournalPath(id);
      const snapshotPath = getSnapshotPath(rootDir, id);
      const rebuilt = rebuildSnapshotFromJournal(journalPath, id);
      snapshotCache.set(id, rebuilt);
      writeSnapshot(snapshotPath, rebuilt.snapshot);
      if (!opts.includeCompleted && COMPLETED_PHASES.has(rebuilt.snapshot.phase)) return null;
      return rebuilt.snapshot;
    },
    listActiveSessions(): LiveSnapshot[] {
      const ids = new Set<string>();
      for (const dir of [legacyRootDir, rootDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length));
        }
      }
      return [...ids]
        .sort()
        .map((id) => store.getSnapshot(id))
        .filter((s): s is LiveSnapshot => s !== null);
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeEvent(event: LiveEvent, fallbackId: string | undefined): LiveEvent {
  if (!event || typeof event !== 'object') throw new Error('event object required');
  const id = event.id || fallbackId;
  if (!id || typeof id !== 'string') throw new Error('event id required');
  if (!event.type || typeof event.type !== 'string') throw new Error('event type required');
  return { ...event, id };
}

function getJournalPath(rootDir: string, id: string): string {
  return path.join(rootDir, safeSessionId(id) + '.jsonl');
}

function getSnapshotPath(rootDir: string, id: string): string {
  return path.join(rootDir, safeSessionId(id) + '.snapshot.json');
}

function safeSessionId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid session id: ' + id);
  return id;
}

function baseSnapshot(id: string): LiveSnapshot {
  return {
    id,
    phase: 'new',
    pageUrl: null,
    sourceFile: null,
    expectedVariants: 0,
    arrivedVariants: 0,
    visibleVariant: null,
    paramValues: {},
    pendingEventSeq: null,
    pendingEvent: null,
    deliveryLease: null,
    checkpointRevision: 0,
    activeOwner: null,
    sourceMarkers: {},
    fallbackMode: null,
    annotationArtifacts: [],
    diagnostics: [],
    updatedAt: null,
  };
}

function rebuildSnapshotFromJournal(journalPath: string, id: string): CachedSnapshot {
  let snapshot = baseSnapshot(id);
  const diagnostics: DiagnosticEntry[] = [];
  let nextSeq = 1;
  if (!fs.existsSync(journalPath)) return { snapshot, diagnostics, nextSeq };

  const lines = fs.readFileSync(journalPath, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as JournalEntry;
      if (!entry || typeof entry !== 'object') throw new Error('entry is not object');
      if (Number.isInteger(entry.seq)) nextSeq = Math.max(nextSeq, entry.seq + 1);
      snapshot = applyEvent(snapshot, entry);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        error: 'journal_parse_failed',
        line: i + 1,
        message,
      });
    }
  }
  snapshot.diagnostics = [...snapshot.diagnostics, ...diagnostics];
  return { snapshot, diagnostics, nextSeq };
}

function applyEvent(
  snapshot: LiveSnapshot,
  entry: JournalEntry,
  inheritedDiagnostics: DiagnosticEntry[] = [],
): LiveSnapshot {
  const event: LiveEvent = entry.event || (entry as unknown as LiveEvent);
  const next: LiveSnapshot = {
    ...snapshot,
    paramValues: { ...(snapshot.paramValues || {}) },
    sourceMarkers: { ...(snapshot.sourceMarkers || {}) },
    annotationArtifacts: [...(snapshot.annotationArtifacts || [])],
    diagnostics: [...(snapshot.diagnostics || [])],
    updatedAt: entry.ts || new Date().toISOString(),
  };

  if (inheritedDiagnostics.length && next.diagnostics.length === 0) {
    next.diagnostics = [...inheritedDiagnostics];
  }

  switch (event.type) {
    case 'generate':
      next.phase = 'generate_requested';
      next.pageUrl = event.pageUrl ?? next.pageUrl;
      next.expectedVariants = event.count ?? next.expectedVariants;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      if (event.screenshotPath)
        upsertArtifact(next.annotationArtifacts, { type: 'screenshot', path: event.screenshotPath });
      break;
    case 'variants_ready':
    case 'agent_done':
      next.phase = event.carbonize === true ? 'carbonize_required' : 'variants_ready';
      next.sourceFile = event.file ?? next.sourceFile;
      next.arrivedVariants =
        event.arrivedVariants ?? (next.arrivedVariants ?? next.expectedVariants);
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      if (event.carbonize === true) {
        next.diagnostics.push({
          error: 'carbonize_cleanup_required',
          file: event.file || null,
          message:
            'Accepted variant still has carbonize markers that must be folded into source CSS.',
        });
      }
      break;
    case 'checkpoint':
      if ((event.revision ?? 0) >= (next.checkpointRevision ?? 0)) {
        next.phase = event.phase ?? next.phase;
        next.checkpointRevision = event.revision ?? next.checkpointRevision;
        next.activeOwner = event.owner ?? next.activeOwner;
        next.arrivedVariants = event.arrivedVariants ?? next.arrivedVariants;
        next.visibleVariant = event.visibleVariant ?? next.visibleVariant;
        if (event.paramValues) next.paramValues = { ...event.paramValues };
      } else {
        next.diagnostics.push({ error: 'stale_checkpoint_ignored', revision: event.revision });
      }
      break;
    case 'accept':
    case 'accept_intent':
      next.phase = 'accept_requested';
      next.visibleVariant = Number(event.variantId ?? next.visibleVariant);
      if (event.paramValues) next.paramValues = { ...event.paramValues };
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'discard':
      next.phase = 'discard_requested';
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'discarded':
      next.phase = 'discarded';
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      break;
    case 'complete':
      next.phase = 'completed';
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      break;
    case 'agent_error':
      next.phase = 'agent_error';
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      next.diagnostics.push({
        error: 'agent_error',
        message: event.message || 'unknown agent error',
      });
      break;
    default:
      next.diagnostics.push({ error: 'unknown_event_type', type: event.type });
      break;
  }
  return next;
}

function toPendingEvent(event: LiveEvent): LiveEvent {
  const pending: LiveEvent = { ...event };
  delete pending.token;
  return pending;
}

function upsertArtifact(artifacts: AnnotationArtifact[], artifact: AnnotationArtifact): void {
  if (!artifacts.some((existing) => existing.path === artifact.path && existing.type === artifact.type)) {
    artifacts.push(artifact);
  }
}

function writeSnapshot(snapshotPath: string, snapshot: LiveSnapshot): void {
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
}
