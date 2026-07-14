// ---------------------------------------------------------------------------
// Session adapter — bridges ralph orchestration concepts to the standard
// SessionStore (`.workflow/sessions/`).
//
// Ralph-specific metadata (task_decomposition, goal_changelog, lifecycle_position,
// etc.) lives in `ralph-meta.json` alongside session.json.  Chain steps map to
// `session.orchestration.chain[]`; decision nodes map to
// `session.orchestration.decision_points[]`.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionStore, type SessionBundle } from '../run/store.js';
import type { SessionState } from '../run/schemas.js';
import { createSessionState } from '../run/defaults.js';
import type {
  CompletionStatus,
  GoalChangelogEntry,
  RalphSessionContext,
  RalphTaskDecompositionItem,
  SessionPlatform,
  VerificationLedgerEntry,
} from './status-schema.js';

// ── Ralph-meta schema ────────────────────────────────────────────────────────

export interface RalphMeta {
  lifecycle_position: string;
  phase: number | null;
  phase_is_new?: boolean;
  milestone: string;
  planning_mode?: 'unified' | 'independent';
  scope_verdict?: 'large' | 'medium' | 'small' | 'unknown' | null;
  analyze_macro_id?: string | null;
  blueprint_id?: string | null;
  cli_tool?: string;
  platform?: SessionPlatform;
  passed_gates?: string[];
  context?: RalphSessionContext;
  decomposition_owner?: 'maestro' | 'ralph' | string;
  execution_owner?: 'ralph-execute' | 'maestro-inline' | string;
  owner_epoch?: number;
  lease_id?: string;
  execution_criteria?: string[];
  task_decomposition?: RalphTaskDecompositionItem[];
  task_decomposition_all_done?: boolean;
  goal_changelog?: GoalChangelogEntry[];
  verification_ledger?: VerificationLedgerEntry[];
  // Per-step enrichment keyed by step_id
  step_details?: Record<string, RalphStepDetail>;
}

export interface RalphStepDetail {
  args: string;
  stage: string;
  scope?: 'phase' | 'standalone' | 'milestone' | null;
  goal_ref?: string | null;
  skill: string;
  retry_count?: number;
  max_retries?: number;
  completion_status?: CompletionStatus | null;
  completion_evidence?: string | string[] | null;
  completion_summary?: string | null;
  completion_decisions?: string[] | null;
  completion_caveats?: string | null;
  completion_deferred?: string[] | null;
  concerns?: string | null;
}

// ── Resolved ralph session (what callers get) ────────────────────────────────

export interface ResolvedRalphSession {
  sessionId: string;
  sessionDir: string;
  bundle: SessionBundle;
  meta: RalphMeta;
}

// ── Read / write ralph-meta.json ─────────────────────────────────────────────

function metaPath(sessionDir: string): string {
  return join(sessionDir, 'ralph-meta.json');
}

function defaultMeta(): RalphMeta {
  return {
    lifecycle_position: 'analyze',
    phase: null,
    milestone: '',
  };
}

export function readMeta(sessionDir: string): RalphMeta {
  const path = metaPath(sessionDir);
  if (!existsSync(path)) return defaultMeta();
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RalphMeta;
  } catch {
    return defaultMeta();
  }
}

export function writeMeta(sessionDir: string, meta: RalphMeta): void {
  const path = metaPath(sessionDir);
  mkdirSync(sessionDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// ── Session resolution ───────────────────────────────────────────────────────

export function resolveRalphSession(
  projectRoot: string,
  sessionId?: string,
  opts: { requireRunning?: boolean } = {},
): ResolvedRalphSession | null {
  const store = new SessionStore(projectRoot);
  const sessionsRoot = store.sessionsRoot;

  if (sessionId) {
    if (!store.sessionExists(sessionId)) return null;
    const bundle = store.readBundle(sessionId);
    if (opts.requireRunning && bundle.session.status !== 'running') return null;
    const sessionDir = store.sessionDir(sessionId);
    return { sessionId, sessionDir, bundle, meta: readMeta(sessionDir) };
  }

  // Find latest ralph-engine session (sorted by mtime DESC)
  if (!existsSync(sessionsRoot)) return null;
  const candidates: Array<{ id: string; mtimeMs: number }> = [];
  for (const name of readdirSync(sessionsRoot)) {
    const dir = join(sessionsRoot, name);
    const sessionFile = join(dir, 'session.json');
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(sessionFile)) continue;
      candidates.push({ id: name, mtimeMs: statSync(sessionFile).mtimeMs });
    } catch { /* skip */ }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const c of candidates) {
    try {
      const bundle = store.readBundle(c.id);
      if (bundle.session.orchestration.engine !== 'ralph') continue;
      if (opts.requireRunning && bundle.session.status !== 'running') continue;
      const sessionDir = store.sessionDir(c.id);
      return { sessionId: c.id, sessionDir, bundle, meta: readMeta(sessionDir) };
    } catch { /* skip corrupt */ }
  }
  return null;
}

// ── Chain ↔ orchestration.chain mapping ──────────────────────────────────────

export interface ChainStep {
  step_id: string;
  command: string;
  status: string;
  run_id: string | null;
  inserted_by: string;
  decision_ref: string | null;
}

export function chainStepId(index: number, command: string): string {
  return `step-${String(index).padStart(3, '0')}-${command}`;
}

export function activeStepIndex(session: SessionState): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status === 'running') return i;
  }
  return null;
}

export function nextPendingIndex(session: SessionState, skipDecisions = true): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status !== 'pending') continue;
    if (skipDecisions && chain[i].decision_ref) continue;
    return i;
  }
  return null;
}

export function nextPendingDecisionIndex(session: SessionState): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status === 'pending' && chain[i].decision_ref) return i;
  }
  return null;
}

// ── Session creation helpers ─────────────────────────────────────────────────

export function createRalphSession(
  projectRoot: string,
  sessionId: string,
  intent: string,
  opts: {
    qualityMode?: 'quick' | 'standard' | 'full';
    autoMode?: boolean;
    boundaryContract?: SessionState['boundary_contract'];
    chain?: ChainStep[];
    decisionPoints?: SessionState['orchestration']['decision_points'];
    meta?: Partial<RalphMeta>;
  } = {},
): ResolvedRalphSession {
  const store = new SessionStore(projectRoot);
  const bundle = store.createSession(sessionId, intent);

  // Set ralph-specific session fields
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'ralph';
    draft.session.orchestration.quality_mode = opts.qualityMode ?? 'standard';
    draft.session.orchestration.auto_mode = opts.autoMode ?? false;
    if (opts.boundaryContract) {
      draft.session.boundary_contract = opts.boundaryContract;
    }
    if (opts.chain) {
      draft.session.orchestration.chain = opts.chain;
    }
    if (opts.decisionPoints) {
      draft.session.orchestration.decision_points = opts.decisionPoints;
    }
    return null;
  });

  const sessionDir = store.sessionDir(sessionId);
  const meta: RalphMeta = { ...defaultMeta(), ...opts.meta };
  writeMeta(sessionDir, meta);

  const updatedBundle = store.readBundle(sessionId);
  return { sessionId, sessionDir, bundle: updatedBundle, meta };
}

// ── Update helpers ───────────────────────────────────────────────────────────

export function updateChainStepStatus(
  projectRoot: string,
  sessionId: string,
  stepIndex: number,
  status: string,
  runId?: string | null,
): void {
  const store = new SessionStore(projectRoot);
  store.update(sessionId, (draft) => {
    const step = draft.session.orchestration.chain[stepIndex];
    if (!step) throw new Error(`Chain step index ${stepIndex} out of range`);
    step.status = status;
    if (runId !== undefined) step.run_id = runId;
    draft.session.activity_revision++;
    return null;
  });
}

export function updateRalphMeta(
  projectRoot: string,
  sessionId: string,
  updater: (meta: RalphMeta) => void,
): void {
  const store = new SessionStore(projectRoot);
  const sessionDir = store.sessionDir(sessionId);
  const meta = readMeta(sessionDir);
  updater(meta);
  writeMeta(sessionDir, meta);
}

// ── Workflow root helper (matches old status-store API) ──────────────────────

export function workflowRoot(): string {
  return resolve(process.cwd());
}
