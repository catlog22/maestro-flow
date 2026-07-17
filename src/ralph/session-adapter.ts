// ---------------------------------------------------------------------------
// Session adapter — bridges ralph orchestration concepts to the standard
// SessionStore (`.workflow/sessions/`).
//
// Orchestration state (chain, decision_points, position, decomposition, lease,
// executor) is single-sourced in session.json (session/1.1). `ralph-meta.json`
// remains only as a legacy read-fallback for unmigrated sessions and as the
// legacy carrier of verification_ledger (see verification-ledger.ts).
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { SessionStore, type SessionBundle } from '../run/store.js';
import type { OrchestrationLease, SessionState } from '../run/schemas.js';
import { createChainSession, chainStepId } from '../run/chain-admin.js';
// Chain navigation/mutation is engine-agnostic and canonical in src/run/chain.ts.
// Re-export here so existing ralph callers keep importing from the adapter while
// the logic lives in one place. Dependency direction is ralph → run only.
import {
  activeStepIndex,
  nextPendingIndex,
  nextPendingDecisionIndex,
  updateChainStepStatus,
} from '../run/chain.js';
export {
  activeStepIndex,
  nextPendingIndex,
  nextPendingDecisionIndex,
  updateChainStepStatus,
} from '../run/chain.js';
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

const ralphTaskDecompositionItemSchema = z.object({
  id: z.string(),
  goal: z.string(),
  boundary: z.string().optional(),
  done_when: z.string().optional(),
  evidence: z.string().optional(),
  lifecycle: z.array(z.string()).optional(),
  status: z.enum(['pending', 'done', 'superseded']),
  completion_confirmed: z.boolean().optional(),
  completed_at: z.string().nullable().optional(),
  superseded_by: z.string().nullable().optional(),
  superseded_at: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
}).passthrough();

const goalSnapshotSchema = z.object({
  id: z.string(),
  goal: z.string(),
  done_when: z.string().optional(),
}).passthrough();

const goalChangelogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  change_type: z.enum(['modify', 'add', 'remove', 'boundary']),
  reason: z.string(),
  impact_assessment: z.object({
    risk_level: z.enum(['low', 'medium', 'high']),
    invalidated_steps: z.array(z.number().int()),
    new_steps_inserted: z.number().int(),
  }).passthrough().optional(),
  before: z.object({
    goals: z.array(goalSnapshotSchema),
    boundary_snippet: z.string().optional(),
  }).passthrough(),
  after: z.object({
    goals: z.array(goalSnapshotSchema),
    boundary_snippet: z.string().optional(),
  }).passthrough(),
}).passthrough();

const verificationLedgerEntrySchema = z.object({
  authority: z.string(),
  dimension: z.string(),
  subject_ids: z.array(z.string()),
  evidence_hashes: z.record(z.string(), z.string()),
  scope_hash: z.string(),
  verdict: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  concerns: z.string().nullable().optional(),
  risk_ceiling: z.enum(['low', 'medium', 'high']),
  created_at: z.string(),
}).passthrough();

const ralphStepDetailSchema = z.object({
  args: z.string(),
  stage: z.string(),
  scope: z.enum(['phase', 'standalone', 'milestone']).nullable().optional(),
  goal_ref: z.string().nullable().optional(),
  skill: z.string(),
  retry_count: z.number().int().nonnegative().optional(),
  max_retries: z.number().int().nonnegative().optional(),
  completion_status: z.enum(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_RETRY', 'BLOCKED']).nullable().optional(),
  completion_evidence: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  completion_summary: z.string().nullable().optional(),
  completion_decisions: z.array(z.string()).nullable().optional(),
  completion_caveats: z.string().nullable().optional(),
  completion_deferred: z.array(z.string()).nullable().optional(),
  concerns: z.string().nullable().optional(),
}).passthrough();

// Legacy metadata remains extensible for one-version compatibility, but every
// field this adapter consumes is runtime-validated. Unknown fields survive;
// known fields with the wrong type fail closed instead of disabling a lease or
// silently erasing orchestration context.
const ralphMetaSchema: z.ZodType<RalphMeta> = z.object({
  lifecycle_position: z.string(),
  phase: z.number().int().nullable(),
  phase_is_new: z.boolean().optional(),
  milestone: z.string(),
  planning_mode: z.enum(['unified', 'independent']).optional(),
  scope_verdict: z.enum(['large', 'medium', 'small', 'unknown']).nullable().optional(),
  analyze_macro_id: z.string().nullable().optional(),
  blueprint_id: z.string().nullable().optional(),
  cli_tool: z.string().optional(),
  platform: z.enum(['claude', 'codex', 'agent', 'agy']).optional(),
  passed_gates: z.array(z.string()).optional(),
  context: z.object({
    issue_id: z.string().nullable().optional(),
    scratch_dir: z.string().nullable().optional(),
    plan_dir: z.string().nullable().optional(),
    analysis_dir: z.string().nullable().optional(),
    brainstorm_dir: z.string().nullable().optional(),
    blueprint_dir: z.string().nullable().optional(),
  }).passthrough().optional(),
  decomposition_owner: z.string().optional(),
  execution_owner: z.string().optional(),
  owner_epoch: z.number().int().nonnegative().optional(),
  lease_id: z.string().optional(),
  execution_criteria: z.array(z.string()).optional(),
  task_decomposition: z.array(ralphTaskDecompositionItemSchema).optional(),
  task_decomposition_all_done: z.boolean().optional(),
  goal_changelog: z.array(goalChangelogEntrySchema).optional(),
  verification_ledger: z.array(verificationLedgerEntrySchema).optional(),
  step_details: z.record(z.string(), ralphStepDetailSchema).optional(),
}).passthrough();

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
    return ralphMetaSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid legacy ralph-meta.json at ${path}: ${detail}`);
  }
}

export function writeMeta(sessionDir: string, meta: RalphMeta): void {
  const path = metaPath(sessionDir);
  const validated = ralphMetaSchema.parse(meta);
  mkdirSync(sessionDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf-8');
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
  status: SessionState['orchestration']['chain'][number]['status'];
  run_id: string | null;
  inserted_by: string;
  decision_ref: string | null;
}

function assertPrebuiltChainIntegrity(
  chain: ChainStep[],
  decisionPoints: SessionState['orchestration']['decision_points'],
): void {
  const stepIds = new Set<string>();
  for (const step of chain) {
    if (stepIds.has(step.step_id)) throw new Error(`duplicate chain step id: ${step.step_id}`);
    stepIds.add(step.step_id);
  }
  const pointIds = new Set<string>();
  for (const point of decisionPoints) {
    if (pointIds.has(point.point_id)) throw new Error(`duplicate decision point: ${point.point_id}`);
    pointIds.add(point.point_id);
    if (point.after_step_id && !stepIds.has(point.after_step_id)) {
      throw new Error(`decision point ${point.point_id} references unknown after_step_id: ${point.after_step_id}`);
    }
  }
  for (const step of chain) {
    if (step.decision_ref && !pointIds.has(step.decision_ref)) {
      throw new Error(`decision_ref has no matching decision point: ${step.decision_ref}`);
    }
  }
}

// Re-export the canonical step-id builder (defined in src/run/chain-admin.ts).
// Direction ralph → run only; existing ralph callers keep importing it here.
export { chainStepId };

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
  assertPrebuiltChainIntegrity(opts.chain ?? [], opts.decisionPoints ?? []);

  // Delegate the session shell (dir, session.json, engine/quality/auto/boundary)
  // to the generic creator; sessionId is an explicit ralph id so it is used
  // verbatim. Ralph passes a pre-built chain/decision_points, so those are
  // overlaid here rather than derived from a chain definition.
  const { sessionId: id } = createChainSession(projectRoot, sessionId, {
    intent,
    engine: 'ralph',
    qualityMode: opts.qualityMode,
    autoMode: opts.autoMode,
    boundaryContract: opts.boundaryContract,
  });

  const store = new SessionStore(projectRoot);
  if (opts.chain || opts.decisionPoints) {
    store.update(id, (draft) => {
      if (opts.chain) draft.session.orchestration.chain = opts.chain;
      if (opts.decisionPoints) draft.session.orchestration.decision_points = opts.decisionPoints;
      return null;
    });
  }

  const sessionDir = store.sessionDir(id);
  const meta: RalphMeta = { ...defaultMeta(), ...opts.meta };
  writeMeta(sessionDir, meta);

  const updatedBundle = store.readBundle(id);
  return { sessionId: id, sessionDir, bundle: updatedBundle, meta };
}

// ── Update helpers ───────────────────────────────────────────────────────────

export function updateRalphMeta(
  projectRoot: string,
  sessionId: string,
  updater: (meta: RalphMeta) => void,
): void {
  const store = new SessionStore(projectRoot);
  const sessionDir = store.sessionDir(sessionId);
  store.withLock(() => {
    const meta = readMeta(sessionDir);
    updater(meta);
    writeMeta(sessionDir, meta);
  });
}

// ── session.json-first position / decomposition readers (1.1 with meta fallback)

/**
 * Effective lifecycle-position fields for a ralph session: session/1.1 promoted
 * them into orchestration.position, so read that first and fall back to
 * ralph-meta.json only when the block is absent (un-migrated 1.0 session). The
 * shape mirrors the ralph-meta fields the display code reads.
 */
export interface EffectivePosition {
  lifecycle_position: string;
  phase: number | null;
  phase_is_new: boolean;
  milestone: string;
  planning_mode: string | null;
  scope_verdict: string | null;
  passed_gates: string[];
}

export function effectivePosition(session: SessionState, meta: RalphMeta): EffectivePosition {
  const p = session.orchestration.position;
  if (p) {
    return {
      lifecycle_position: p.lifecycle,
      phase: p.phase,
      phase_is_new: p.phase_is_new,
      milestone: p.milestone,
      planning_mode: p.planning_mode,
      scope_verdict: p.scope_verdict,
      passed_gates: p.passed_gates,
    };
  }
  return {
    lifecycle_position: meta.lifecycle_position,
    phase: meta.phase,
    phase_is_new: meta.phase_is_new ?? false,
    milestone: meta.milestone,
    planning_mode: meta.planning_mode ?? null,
    scope_verdict: meta.scope_verdict ?? null,
    passed_gates: meta.passed_gates ?? [],
  };
}

/**
 * Effective sub-goal decomposition for a ralph session: session/1.1 promoted
 * task_decomposition + execution_criteria into orchestration.decomposition, so
 * read that first and fall back to the legacy ralph-meta arrays when absent.
 */
export interface EffectiveDecomposition {
  execution_criteria: string[];
  goals: RalphTaskDecompositionItem[];
  changelog: GoalChangelogEntry[];
}

export function effectiveDecomposition(session: SessionState, meta: RalphMeta): EffectiveDecomposition {
  const d = session.orchestration.decomposition;
  if (d) {
    return {
      execution_criteria: d.execution_criteria,
      goals: d.goals as RalphTaskDecompositionItem[],
      changelog: d.changelog as GoalChangelogEntry[],
    };
  }
  return {
    execution_criteria: meta.execution_criteria ?? [],
    goals: meta.task_decomposition ?? [],
    changelog: meta.goal_changelog ?? [],
  };
}

/** Canonical Session 1.1 lease with legacy ralph-meta fallback. */
export function effectiveLease(session: SessionState, meta: RalphMeta): OrchestrationLease | null {
  if (session.orchestration.lease) return session.orchestration.lease;
  if (meta.execution_owner == null && meta.owner_epoch == null && meta.lease_id == null) return null;
  return {
    owner: meta.execution_owner ?? null,
    epoch: meta.owner_epoch ?? 0,
    id: meta.lease_id ?? null,
  };
}

// ── Workflow root helper (matches old status-store API) ──────────────────────

export function workflowRoot(): string {
  return resolve(process.cwd());
}
