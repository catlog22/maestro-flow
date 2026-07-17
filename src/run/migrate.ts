// ---------------------------------------------------------------------------
// `maestro session migrate` — fold a legacy ralph-meta.json into session.json
// and stamp the session at schema_version session/1.1.
//
// The migration is explicit and idempotent. ralph-meta.json is the pre-1.1
// side channel for ralph orchestration state; this merges its editorial fields
// (position / decomposition / lease / executor + per-step chain enrichment)
// into the canonical session.json orchestration block. The source file is left
// in place — verification_ledger and the excluded fields keep living there until
// a later milestone retires it.
//
// src/run must never import src/ralph, so ralph-meta.json is read here through a
// deliberately loose local shape rather than the RalphMeta type.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionStore } from './store.js';
import type {
  GoalChangelogEntry,
  OrchestrationDecomposition,
  OrchestrationExecutor,
  OrchestrationLease,
  OrchestrationPosition,
  TaskDecompositionItem,
} from './schemas.js';

export type MigrateStatus = 'migrated' | 'already-migrated' | 'version-only';

export interface MigrateResult {
  session_id: string;
  status: MigrateStatus;
  had_ralph_meta: boolean;
  mapped_steps: number;
}

// ── Loose ralph-meta shape (read-only, no src/ralph dependency) ──────────────

interface RalphStepDetailLoose {
  args?: string;
  stage?: string;
  goal_ref?: string | null;
  retry_count?: number;
  max_retries?: number;
  // completion_* / concerns are intentionally not read (handoff is the source).
}

interface RalphMetaLoose {
  lifecycle_position?: string;
  phase?: number | null;
  phase_is_new?: boolean;
  milestone?: string;
  planning_mode?: string | null;
  passed_gates?: string[];
  scope_verdict?: string | null;
  execution_criteria?: string[];
  task_decomposition?: TaskDecompositionItem[];
  goal_changelog?: GoalChangelogEntry[];
  execution_owner?: string | null;
  owner_epoch?: number;
  lease_id?: string | null;
  cli_tool?: string;
  platform?: string;
  step_details?: Record<string, RalphStepDetailLoose>;
  // verification_ledger / context / protocol_version stay in ralph-meta.json.
}

// Default retry ceiling mirrors the ralph decision node default (max_retries: 2).
const DEFAULT_RETRY_MAX = 2;

function readRalphMeta(sessionDir: string): RalphMetaLoose | null {
  const path = join(sessionDir, 'ralph-meta.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RalphMetaLoose;
  } catch (error) {
    throw new Error(`invalid legacy ralph-meta.json at ${path}: ${(error as Error).message}`);
  }
}

function buildPosition(meta: RalphMetaLoose): OrchestrationPosition {
  return {
    lifecycle: meta.lifecycle_position ?? '',
    phase: meta.phase ?? null,
    phase_is_new: meta.phase_is_new ?? false,
    milestone: meta.milestone ?? '',
    planning_mode: meta.planning_mode ?? null,
    passed_gates: meta.passed_gates ?? [],
    scope_verdict: meta.scope_verdict ?? null,
  };
}

function buildDecomposition(meta: RalphMetaLoose): OrchestrationDecomposition | null {
  const hasContent = (meta.execution_criteria?.length ?? 0) > 0
    || (meta.task_decomposition?.length ?? 0) > 0
    || (meta.goal_changelog?.length ?? 0) > 0;
  if (!hasContent) return null;
  return {
    execution_criteria: meta.execution_criteria ?? [],
    goals: meta.task_decomposition ?? [],
    changelog: meta.goal_changelog ?? [],
  };
}

function buildLease(meta: RalphMetaLoose): OrchestrationLease | null {
  if (meta.execution_owner == null && meta.owner_epoch == null && meta.lease_id == null) {
    return null;
  }
  return {
    owner: meta.execution_owner ?? null,
    epoch: meta.owner_epoch ?? 0,
    id: meta.lease_id ?? null,
  };
}

function buildExecutor(meta: RalphMetaLoose): OrchestrationExecutor | null {
  if (meta.platform == null && meta.cli_tool == null) return null;
  return {
    platform: meta.platform ?? '',
    cli_tool: meta.cli_tool ?? '',
  };
}

/**
 * Merge ralph-meta.json into session.json and stamp session/1.1. Idempotent:
 * a session already carrying position or decomposition is treated as migrated
 * and returned untouched. A session with a running chain step is rejected — the
 * caller must complete it first so migration never races an in-flight step.
 */
export function migrateSession(projectRoot: string, sessionId: string): MigrateResult {
  const root = resolve(projectRoot);
  const store = new SessionStore(root);
  if (!store.sessionExists(sessionId)) {
    throw new Error(`session not found: ${sessionId}`);
  }

  const bundle = store.readBundle(sessionId);
  const session = bundle.session;
  const orch = session.orchestration;

  const runningStep = orch.chain.find(step => step.status === 'running');
  if (runningStep) {
    throw new Error(
      `session ${sessionId} has a running chain step (${runningStep.step_id}); complete it before migrating`,
    );
  }

  const sessionDir = store.sessionDir(sessionId);
  const meta = readRalphMeta(sessionDir);

  // No ralph-meta: nothing to fold. The store write-back stamps session/1.1.
  if (!meta) {
    if (session.schema_version === 'session/1.1') {
      return { session_id: sessionId, status: 'already-migrated', had_ralph_meta: false, mapped_steps: 0 };
    }
    store.update(sessionId, (draft) => {
      draft.session.activity_revision++;
      return null;
    });
    return { session_id: sessionId, status: 'version-only', had_ralph_meta: false, mapped_steps: 0 };
  }

  const stepDetails = meta.step_details ?? {};
  const applied = store.update(sessionId, (draft) => {
    const o = draft.session.orchestration;
    let changed = draft.session.schema_version === 'session/1.0';
    let mappedSteps = 0;
    if (o.position === null) { o.position = buildPosition(meta); changed = true; }
    const decomposition = buildDecomposition(meta);
    if (o.decomposition === null && decomposition !== null) { o.decomposition = decomposition; changed = true; }
    const lease = buildLease(meta);
    if (o.lease === null && lease !== null) { o.lease = lease; changed = true; }
    const executor = buildExecutor(meta);
    if (o.executor === null && executor !== null) { o.executor = executor; changed = true; }

    // Fold per-step enrichment onto chain steps, matched by step_id.
    for (const step of o.chain) {
      const detail = stepDetails[step.step_id];
      if (!detail) continue;
      let mapped = false;
      if (step.args === undefined && detail.args !== undefined) { step.args = detail.args; mapped = true; }
      if (step.stage === undefined && detail.stage !== undefined) { step.stage = detail.stage; mapped = true; }
      if (step.goal_ref === undefined && detail.goal_ref !== undefined) { step.goal_ref = detail.goal_ref; mapped = true; }
      if (step.retry === undefined) {
        step.retry = { count: detail.retry_count ?? 0, max: detail.max_retries ?? DEFAULT_RETRY_MAX };
        mapped = true;
      }
      if (mapped) { mappedSteps++; changed = true; }
    }

    if (changed) draft.session.activity_revision++;
    return { changed, mappedSteps };
  });

  return {
    session_id: sessionId,
    status: applied.changed ? 'migrated' : 'already-migrated',
    had_ralph_meta: true,
    mapped_steps: applied.mappedSteps,
  };
}

/**
 * Migrate every session under `.workflow/sessions/`. Each session is migrated
 * independently; a failure on one is captured and reported without aborting the
 * batch.
 */
export function migrateAllSessions(
  projectRoot: string,
): Array<{ session_id: string; result?: MigrateResult; error?: string }> {
  const root = resolve(projectRoot);
  const store = new SessionStore(root);
  const out: Array<{ session_id: string; result?: MigrateResult; error?: string }> = [];
  if (!existsSync(store.sessionsRoot)) return out;

  for (const name of readdirSync(store.sessionsRoot)) {
    const dir = join(store.sessionsRoot, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, 'session.json'))) continue;
    } catch {
      continue;
    }
    try {
      out.push({ session_id: name, result: migrateSession(root, name) });
    } catch (error) {
      out.push({ session_id: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
