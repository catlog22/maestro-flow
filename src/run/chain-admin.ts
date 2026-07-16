// ---------------------------------------------------------------------------
// Chain administration — engine-agnostic Session creation from a predefined
// chain definition, plus the three chain-edit verbs (insert / skip / replace).
//
// This is the canonical home for chain building and mutation that the CLI
// (`maestro session create` / `maestro session chain …`) drives. The ralph
// adapter reuses `createChainSession` (dependency direction ralph → run only;
// src/run must never import src/ralph), so `chainStepId` lives here rather than
// in src/ralph/session-adapter.ts.
//
// All writes go through the single SessionStore.update path so validation,
// backup, and revision bumps stay consistent with the rest of the store.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { SessionStore } from './store.js';
import { decompositionSchema, positionSchema } from './schemas.js';
import type {
  OrchestrationDecomposition,
  OrchestrationPosition,
  OrchestrationStep,
  SessionState,
} from './schemas.js';

// ── Step id convention (canonical) ───────────────────────────────────────────
// Mirrors the historic ralph convention `step-{NNN}-{command}` so migrated and
// freshly built chains keep a single id shape.

export function chainStepId(index: number, command: string): string {
  return `step-${String(index).padStart(3, '0')}-${command}`;
}

// ── Chain definition schema (file / stdin input) ─────────────────────────────
// Kept local to chain-admin: this is the CLI input surface, not a persisted
// session block. Fields align with orchestrationStepSchema / decisionPointSchema
// on the input face; persisted step ids and status are derived here.

const chainDefStepSchema = z.object({
  command: z.string().min(1),
  args: z.string().optional(),
  stage: z.string().nullable().optional(),
  goal_ref: z.string().nullable().optional(),
  retry_max: z.number().int().nonnegative().optional(),
  // A decision node: names the decision point this step gates on. When set the
  // step is a decision node (dispatched by the orchestrator, not run as a Run).
  decision_ref: z.string().nullable().optional(),
}).strict();

const chainDefDecisionPointSchema = z.object({
  point_id: z.string().min(1),
  after_step_id: z.string().nullable().optional(),
  max_retries: z.number().int().nonnegative().optional(),
}).strict();

const chainDefPositionSchema = z.object({
  lifecycle: z.string(),
  phase: z.number().int().nullable().optional(),
  phase_is_new: z.boolean().optional(),
  milestone: z.string().optional(),
  planning_mode: z.string().nullable().optional(),
  passed_gates: z.array(z.string()).optional(),
  scope_verdict: z.string().nullable().optional(),
}).strict();

const chainDefDecompositionSchema = z.object({
  execution_criteria: z.array(z.string()).optional(),
  goals: z.array(z.unknown()).optional(),
  changelog: z.array(z.unknown()).optional(),
}).strict();

const chainDefExecutorSchema = z.object({
  platform: z.string(),
  cli_tool: z.string(),
}).strict();

export const chainDefinitionSchema = z.object({
  intent: z.string().min(1).optional(),
  engine: z.enum(['ralph', 'coordinator', 'manual']).optional(),
  quality_mode: z.enum(['quick', 'standard', 'full']).optional(),
  auto_mode: z.boolean().optional(),
  steps: z.array(chainDefStepSchema).min(1),
  decision_points: z.array(chainDefDecisionPointSchema).optional(),
  position: chainDefPositionSchema.nullable().optional(),
  decomposition: chainDefDecompositionSchema.nullable().optional(),
  executor: chainDefExecutorSchema.nullable().optional(),
}).strict();

export type ChainDefinition = z.infer<typeof chainDefinitionSchema>;

// Default retry ceiling mirrors the ralph decision node default (max_retries: 2).
const DEFAULT_RETRY_MAX = 2;
// Default decision retry ceiling mirrors A_BUILD_STEPS rule 4 (max_retries: 2).
const DEFAULT_DECISION_MAX_RETRIES = 2;

export interface CreateChainSessionOpts {
  intent?: string;
  engine?: 'ralph' | 'coordinator' | 'manual';
  qualityMode?: 'quick' | 'standard' | 'full';
  autoMode?: boolean;
  boundaryContract?: SessionState['boundary_contract'];
  definition?: ChainDefinition;
}

export interface CreateChainSessionResult {
  sessionId: string;
  sessionDir: string;
  session: SessionState;
}

// ── Chain assembly from a definition ─────────────────────────────────────────

function buildChain(steps: ChainDefinition['steps']): OrchestrationStep[] {
  return steps.map((step, index) => {
    const decisionRef = step.decision_ref ?? null;
    const chainStep: OrchestrationStep = {
      step_id: chainStepId(index, step.command),
      command: step.command,
      status: 'pending',
      run_id: null,
      inserted_by: 'build',
      decision_ref: decisionRef,
    };
    if (step.args !== undefined) chainStep.args = step.args;
    if (step.stage !== undefined) chainStep.stage = step.stage;
    if (step.goal_ref !== undefined) chainStep.goal_ref = step.goal_ref;
    // Execution steps carry a retry counter; decision nodes are gated by their
    // decision point's own retry_count, so they do not.
    if (!decisionRef) {
      chainStep.retry = { count: 0, max: step.retry_max ?? DEFAULT_RETRY_MAX };
    }
    return chainStep;
  });
}

function buildDecisionPoints(
  def: ChainDefinition,
): SessionState['orchestration']['decision_points'] {
  const points = def.decision_points ?? [];
  return points.map(point => ({
    point_id: point.point_id,
    after_step_id: point.after_step_id ?? null,
    status: 'pending',
    retry_count: 0,
    max_retries: point.max_retries ?? DEFAULT_DECISION_MAX_RETRIES,
    evidence_ref: null,
  }));
}

function buildPosition(def: ChainDefinition): SessionState['orchestration']['position'] {
  if (!def.position) return null;
  const p = def.position;
  return {
    lifecycle: p.lifecycle,
    phase: p.phase ?? null,
    phase_is_new: p.phase_is_new ?? false,
    milestone: p.milestone ?? '',
    planning_mode: p.planning_mode ?? null,
    passed_gates: p.passed_gates ?? [],
    scope_verdict: p.scope_verdict ?? null,
  };
}

function buildDecomposition(def: ChainDefinition): OrchestrationDecomposition | null {
  if (!def.decomposition) return null;
  // The container is shaped here; store.update() re-parses the whole draft
  // against sessionStateSchema, so a malformed goals/changelog entry is rejected
  // there rather than silently persisted.
  const d = def.decomposition;
  return {
    execution_criteria: d.execution_criteria ?? [],
    goals: (d.goals ?? []) as OrchestrationDecomposition['goals'],
    changelog: (d.changelog ?? []) as OrchestrationDecomposition['changelog'],
  };
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.\-TZ]/g, '').slice(0, 14);
}

/**
 * Derive a session id from a slug, aligning with the ralph convention
 * `ralph-{YYYYMMDD-HHmmss}`: the slug replaces the fixed prefix. A slug that
 * already looks like a full session id (contains a 14-digit timestamp tail) is
 * used verbatim so callers can pin an explicit id.
 */
export function deriveSessionId(slug: string): string {
  const trimmed = slug.trim();
  if (/\d{8}-\d{6}$/.test(trimmed) || /\d{14}$/.test(trimmed)) return trimmed;
  const ts = timestampId();
  const stamp = `${ts.slice(0, 8)}-${ts.slice(8, 14)}`;
  return `${trimmed}-${stamp}`;
}

/**
 * Create a Session from an optional predefined chain definition. Engine may be
 * ralph / coordinator / manual. When no definition is supplied an empty-chain
 * session is created (intent only). The session id is derived from `slug` unless
 * an explicit id is passed.
 */
export function createChainSession(
  projectRoot: string,
  slug: string,
  opts: CreateChainSessionOpts = {},
): CreateChainSessionResult {
  const def = opts.definition;
  const intent = opts.intent ?? def?.intent;
  if (!intent) {
    throw new Error('intent is required (pass opts.intent or definition.intent)');
  }

  const sessionId = deriveSessionId(slug);
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, intent);

  const engine = opts.engine ?? def?.engine ?? 'manual';
  const qualityMode = opts.qualityMode ?? def?.quality_mode ?? 'standard';
  const autoMode = opts.autoMode ?? def?.auto_mode ?? false;

  store.update(sessionId, (draft) => {
    const o = draft.session.orchestration;
    o.engine = engine;
    o.quality_mode = qualityMode;
    o.auto_mode = autoMode;
    if (opts.boundaryContract) {
      draft.session.boundary_contract = opts.boundaryContract;
    }
    if (def) {
      o.chain = buildChain(def.steps);
      o.decision_points = buildDecisionPoints(def);
      o.position = buildPosition(def);
      o.decomposition = buildDecomposition(def);
      if (def.executor) o.executor = { platform: def.executor.platform, cli_tool: def.executor.cli_tool };
    }
    return null;
  });

  const session = store.readBundle(sessionId).session;
  return { sessionId, sessionDir: store.sessionDir(sessionId), session };
}

// ── Chain edit verbs ─────────────────────────────────────────────────────────

/**
 * The lowest chain index a new step may occupy. A step may only be inserted
 * after every completed / running / sealed / skipped step — i.e. into the still
 * -pending tail. This is one past the last non-pending step.
 */
function activeBoundary(chain: OrchestrationStep[]): number {
  let boundary = 0;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status !== 'pending') boundary = i + 1;
  }
  return boundary;
}

/** Resolve an `after` selector (step_id or numeric index) to a chain index. */
function resolveAfterIndex(chain: OrchestrationStep[], after: string): number {
  const asIndex = Number(after);
  if (Number.isInteger(asIndex) && String(asIndex) === after.trim()) {
    if (asIndex < 0 || asIndex >= chain.length) {
      throw new Error(`after index ${asIndex} out of range (chain has ${chain.length} steps)`);
    }
    return asIndex;
  }
  const idx = chain.findIndex(step => step.step_id === after);
  if (idx === -1) throw new Error(`after step not found: ${after}`);
  return idx;
}

export interface InsertChainStepOpts {
  after: string;
  command: string;
  args?: string;
  stage?: string | null;
  goalRef?: string | null;
  insertedBy: string;
  decisionRef?: string | null;
}

/**
 * Insert a new pending step after the `after` step (step_id or index). The
 * insertion slot must be inside the still-pending tail: inserting before any
 * completed / running / sealed / skipped step is rejected. Inserting after the
 * active step (the fix-loop case) is allowed.
 */
export function insertChainStep(
  projectRoot: string,
  sessionId: string,
  opts: InsertChainStepOpts,
): OrchestrationStep {
  const store = new SessionStore(projectRoot);
  return store.update(sessionId, (draft) => {
    const chain = draft.session.orchestration.chain;
    const afterIdx = resolveAfterIndex(chain, opts.after);
    const insertPos = afterIdx + 1;
    const boundary = activeBoundary(chain);
    if (insertPos < boundary) {
      throw new Error(
        `cannot insert before the active position: insert slot ${insertPos} < active boundary ${boundary} `
        + `(a completed/running/sealed/skipped step occupies index ${boundary - 1})`,
      );
    }
    const decisionRef = opts.decisionRef ?? null;
    const step: OrchestrationStep = {
      step_id: chainStepId(insertPos, opts.command),
      command: opts.command,
      status: 'pending',
      run_id: null,
      inserted_by: opts.insertedBy,
      decision_ref: decisionRef,
    };
    if (opts.args !== undefined) step.args = opts.args;
    if (opts.stage !== undefined) step.stage = opts.stage;
    if (opts.goalRef !== undefined) step.goal_ref = opts.goalRef;
    if (!decisionRef) step.retry = { count: 0, max: DEFAULT_RETRY_MAX };
    chain.splice(insertPos, 0, step);
    draft.session.activity_revision++;
    return step;
  });
}

/**
 * Skip a pending chain step. Only `pending` steps may be skipped — completed /
 * running / sealed / already-skipped steps are rejected. `skipped` is a free
 * status string (the step status field is not a closed enum), and chain.ts's
 * nextPendingIndex selects only `status === 'pending'`, so a skipped step is
 * naturally excluded from step driving.
 */
export function skipChainStep(
  projectRoot: string,
  sessionId: string,
  stepId: string,
): OrchestrationStep {
  const store = new SessionStore(projectRoot);
  return store.update(sessionId, (draft) => {
    const step = draft.session.orchestration.chain.find(s => s.step_id === stepId);
    if (!step) throw new Error(`chain step not found: ${stepId}`);
    if (step.status !== 'pending') {
      throw new Error(`only pending steps can be skipped; ${stepId} is ${step.status}`);
    }
    step.status = 'skipped';
    step.run_id = null;
    draft.session.activity_revision++;
    return step;
  });
}

export interface ReplaceChainStepOpts {
  command?: string;
  args?: string;
  stage?: string | null;
  goalRef?: string | null;
}

/**
 * Replace fields of a pending chain step in place. Only `pending` steps may be
 * replaced. When `command` changes the step_id is regenerated at the step's
 * current index to keep the `step-{NNN}-{command}` convention consistent.
 */
export function replaceChainStep(
  projectRoot: string,
  sessionId: string,
  stepId: string,
  opts: ReplaceChainStepOpts,
): OrchestrationStep {
  const store = new SessionStore(projectRoot);
  return store.update(sessionId, (draft) => {
    const chain = draft.session.orchestration.chain;
    const index = chain.findIndex(s => s.step_id === stepId);
    if (index === -1) throw new Error(`chain step not found: ${stepId}`);
    const step = chain[index];
    if (step.status !== 'pending') {
      throw new Error(`only pending steps can be replaced; ${stepId} is ${step.status}`);
    }
    if (opts.command !== undefined) {
      step.command = opts.command;
      step.step_id = chainStepId(index, opts.command);
    }
    if (opts.args !== undefined) step.args = opts.args;
    if (opts.stage !== undefined) step.stage = opts.stage;
    if (opts.goalRef !== undefined) step.goal_ref = opts.goalRef;
    draft.session.activity_revision++;
    return step;
  });
}

// ── Orchestration meta update (position / decomposition整块替换) ───────────────

export interface MetaUpdateOpts {
  /** Parsed JSON validated against positionSchema; null clears the block. */
  position?: OrchestrationPosition | null;
  /** Parsed JSON validated against decompositionSchema; null clears the block. */
  decomposition?: OrchestrationDecomposition | null;
}

export interface MetaUpdateResult {
  session_id: string;
  updated: Array<'position' | 'decomposition'>;
  position: OrchestrationPosition | null;
  decomposition: OrchestrationDecomposition | null;
}

/**
 * Parse + validate a caller-supplied position block against positionSchema. The
 * error is surfaced verbatim to the CLI so a malformed block reports the exact
 * offending field rather than a whole-session parse failure.
 */
export function parsePositionInput(raw: unknown): OrchestrationPosition {
  return positionSchema.parse(raw);
}

/** Parse + validate a caller-supplied decomposition block against decompositionSchema. */
export function parseDecompositionInput(raw: unknown): OrchestrationDecomposition {
  return decompositionSchema.parse(raw);
}

/**
 * Integral-replace orchestration.position and/or orchestration.decomposition.
 * The single write入口 for goal-audit / task_decomposition status flips /
 * goal_changelog appends — the prompt layer rebuilds the whole block and submits
 * it here rather than editing session.json directly. At least one block must be
 * provided (enforced by the caller). Blocks are validated by the caller via
 * parsePositionInput / parseDecompositionInput before this replaces them; the
 * store.update re-parse is the final guard.
 */
export function updateSessionMeta(
  projectRoot: string,
  sessionId: string,
  opts: MetaUpdateOpts,
): MetaUpdateResult {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) {
    throw new Error(`session not found: ${sessionId}`);
  }
  return store.update(sessionId, (draft) => {
    const o = draft.session.orchestration;
    const updated: Array<'position' | 'decomposition'> = [];
    if (opts.position !== undefined) {
      o.position = opts.position;
      updated.push('position');
    }
    if (opts.decomposition !== undefined) {
      o.decomposition = opts.decomposition;
      updated.push('decomposition');
    }
    draft.session.activity_revision++;
    return {
      session_id: sessionId,
      updated,
      position: o.position ?? null,
      decomposition: o.decomposition ?? null,
    };
  });
}
