// ---------------------------------------------------------------------------
// `maestro run decide` — CLI-writes a decision point's verdict + advances the
// chain, the generic-layer equivalent of the ralph A_APPLY_PROCEED /
// A_APPLY_FIX / A_APPLY_ESCALATE actions.
//
// **The evaluation stays in the prompt layer** (maestro-ralph.md's evaluation
// Agent produces the verdict + confidence). This verb only records that verdict
// onto session.orchestration.decision_points[point_id] and moves the matching
// chain decision node so `run next` can continue. It never re-evaluates.
//
// Verdict semantics (mirroring the FSM S_APPLY_VERDICT transitions):
//   proceed  → decision_point.status = 'passed'; the matching chain decision node
//              seals (terminal, like reconcileSealedSteps), so nextPendingIndex /
//              nextPendingDecisionIndex both step past it and `run next` advances.
//   fix      → decision_point.retry_count++, status stays 'pending' (待决). The CLI
//              does not cap — the retry ceiling is a prompt-layer FSM decision —
//              but reports `exhausted` when count reaches max_retries and points
//              at `maestro session chain insert` for the fix step.
//   escalate → decision_point.status = 'escalated'; session status → 'paused'
//              (aligns FSM A_PAUSE_ESCALATE). The chain decision node stays pending
//              so resuming the session re-surfaces it.
//
// --summary / --evidence land on decision_point.evidence_ref. Decision authority
// and its projection record commit with the transition receipt; decisions.ndjson
// is then deterministically rebuilt from receipts and may be repaired on replay.
//
// src/run must never import src/ralph — this lives here so the ralph adapter can
// reuse it (direction ralph → run only).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore, type SessionBundle } from './store.js';
import { localISO, safeRename } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';
import { checkLease } from './lease.js';
import {
  assertTransitionMutationRevisions,
  createTransitionOutcome,
  prepareTransitionMutation,
  transitionMutationReceipt,
  type TransitionMutationOptions,
  type TransitionMutationReceipt,
} from './transition-receipts.js';

export type DecisionVerdict = 'proceed' | 'fix' | 'escalate';
export type DecisionConfidence = 'high' | 'medium' | 'low';

export interface DecideNextSuggestion {
  suggest_only: true;
  action: 'resolve_session' | 'insert_fix' | 'dispatch_next';
  command: string | null;
  reason: string;
  preconditions: string[];
}

export interface DecideOptions {
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  summary?: string;
  /** Evidence path/reference recorded on decision_point.evidence_ref. */
  evidence?: string;
  transition?: Partial<TransitionMutationOptions>;
}

export interface DecideResult {
  session_id: string;
  point_id: string;
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  /** decision_point.status after the verdict. */
  point_status: string;
  /** Retry counter after a fix bump (null for proceed / escalate). */
  retry: { count: number; max: number; exhausted: boolean } | null;
  /** The matching chain decision node, or null when none references this point. */
  chain: { step_id: string; index: number; step_status: string } | null;
  /** Session status after the verdict (paused on escalate, unchanged otherwise). */
  session_status: SessionState['status'];
  /** Next-step pointer closing decide → next. */
  next: DecideNextSuggestion;
  transition: TransitionMutationReceipt;
  /** Projection failures never roll back decision authority. */
  projection_pending: boolean;
}

interface DecisionProjectionRecord {
  transition_id: string;
  type: 'decide';
  point_id: string;
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  summary: string | null;
  evidence_ref: string | null;
  retry_count: number | null;
  timestamp: string;
}

/** Index of the chain decision node referencing this point, or -1. */
function chainDecisionNodeIndex(session: SessionState, pointId: string): number {
  return session.orchestration.chain.findIndex(step => step.decision_ref === pointId);
}

/**
 * The next-step pointer after a decision is recorded. An escalation points at
 * the first phase of canonical recovery; otherwise `run next` continues the chain.
 */
function decideNextPointer(
  session: SessionState,
  verdict: DecisionVerdict,
): DecideNextSuggestion {
  const sessionId = session.session_id;
  if (verdict === 'escalate') {
    return {
      suggest_only: true,
      action: 'resolve_session',
      command: `maestro session resolve --session ${sessionId} --request-id <request-id> --actor <actor> --reason <reason> --evidence <ref> --expected-identity-revision <n> --expected-activity-revision <n> --decision <point-id> --disposition <proceed|retry>`,
      reason: 'session paused by escalation — canonical recovery is explicit resolve, then resume, then run next',
      preconditions: [
        'resolve the escalated decision; the Session remains paused',
        'resume only after every blocker and concurrency guard is clear',
        'run maestro run next explicitly to allocate the next Run',
      ],
    };
  }
  if (verdict === 'fix') {
    return {
      suggest_only: true,
      action: 'insert_fix',
      command: `maestro session chain insert --session ${sessionId} --after <step_id|index> --command <fix-command>`,
      reason: 'fix verdict — insert repair step(s), then advance with maestro run next',
      preconditions: ['fix scope is approved', 'inserted step is bound to this Session'],
    };
  }
  return {
    suggest_only: true,
    action: 'dispatch_next',
    command: `maestro run next --session ${sessionId}`,
    reason: 'decision passed — advance the chain',
    preconditions: ['session_status=running', 'decision point remains passed'],
  };
}

function decisionProjectionFromReceipt(value: unknown): DecisionProjectionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.transition_id !== 'string' || raw.type !== 'decide'
    || typeof raw.point_id !== 'string'
    || !['proceed', 'fix', 'escalate'].includes(String(raw.verdict))
    || !['high', 'medium', 'low'].includes(String(raw.confidence))
    || typeof raw.timestamp !== 'string') return null;
  return raw as unknown as DecisionProjectionRecord;
}

/** Rebuild the deterministic, de-duplicated decisions.ndjson receipt projection. */
export function ensureDecisionLogProjection(
  projectRoot: string,
  sessionId: string,
  requiredTransitionId?: string,
): boolean {
  const store = new SessionStore(projectRoot);
  let tmpPath: string | null = null;
  try {
    return store.withLock(() => {
      const records = store.readBundle(sessionId).session.requests
        .filter(item => item.type === 'transition' && 'outcome' in item)
        .filter(item => item.outcome.operation === 'decide' && item.outcome.status === 'applied')
        .map(item => ({
          appliedAt: item.outcome.applied_at,
          projection: decisionProjectionFromReceipt(item.outcome.result.decision_projection),
        }))
        .filter((item): item is { appliedAt: string; projection: DecisionProjectionRecord } => item.projection !== null)
        .sort((left, right) => left.appliedAt.localeCompare(right.appliedAt)
          || left.projection.transition_id.localeCompare(right.projection.transition_id));
      const unique = new Map(records.map(item => [item.projection.transition_id, item.projection]));
      if (requiredTransitionId && !unique.has(requiredTransitionId)) {
        throw new Error(`decision receipt ${requiredTransitionId} has no projection record`);
      }
      const path = join(store.sessionDir(sessionId), 'decisions.ndjson');
      tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
      const body = [...unique.values()].map(item => JSON.stringify(item)).join('\n');
      writeFileSync(tmpPath, body ? `${body}\n` : '', 'utf8');
      safeRename(tmpPath, path);
      tmpPath = null;
      return true;
    });
  } catch (error) {
    if (tmpPath && existsSync(tmpPath)) rmSync(tmpPath, { force: true });
    console.error(`[maestro run decide] decision projection pending: ${(error as Error).message}`);
    return false;
  }
}

type DecideAuthorityResult = Omit<DecideResult, 'transition' | 'projection_pending'>;

/** Apply one decision to an in-memory authority draft and build its projection. */
export function applyDecideMutation(
  draft: SessionBundle,
  pointId: string,
  options: DecideOptions,
  transitionId: string,
  appliedAt: string,
): { decision: DecideAuthorityResult; decision_projection: DecisionProjectionRecord } {
  const orch = draft.session.orchestration;
  const point = orch.decision_points.find(candidate => candidate.point_id === pointId);
  if (!point) {
    const known = orch.decision_points.map(candidate => candidate.point_id).join(', ') || '(none)';
    throw new Error(`decision point not found: ${pointId} (known: ${known})`);
  }
  if (point.status !== 'pending') {
    throw new Error(`decision point ${pointId} is already ${point.status}; terminal decisions cannot be re-decided`);
  }
  const evidenceRef = options.evidence?.trim() || options.summary?.trim() || null;
  const nodeIdx = chainDecisionNodeIndex(draft.session, pointId);
  const node = nodeIdx >= 0 ? orch.chain[nodeIdx] : null;
  let retry: DecideResult['retry'] = null;
  switch (options.verdict) {
    case 'proceed':
      point.status = 'passed';
      if (node) node.status = 'sealed';
      break;
    case 'fix': {
      point.retry_count += 1;
      retry = { count: point.retry_count, max: point.max_retries, exhausted: point.retry_count >= point.max_retries };
      break;
    }
    case 'escalate':
      point.status = 'escalated';
      draft.session.status = 'paused';
      break;
  }
  if (evidenceRef !== null) point.evidence_ref = evidenceRef;
  draft.session.activity_revision++;
  return {
    decision: {
      session_id: draft.session.session_id,
      point_id: pointId,
      verdict: options.verdict,
      confidence: options.confidence,
      point_status: point.status,
      retry,
      chain: node ? { step_id: node.step_id, index: nodeIdx, step_status: node.status } : null,
      session_status: draft.session.status,
      next: decideNextPointer(draft.session, options.verdict),
    },
    decision_projection: {
      transition_id: transitionId,
      type: 'decide',
      point_id: pointId,
      verdict: options.verdict,
      confidence: options.confidence,
      summary: options.summary ?? null,
      evidence_ref: evidenceRef,
      retry_count: retry?.count ?? null,
      timestamp: appliedAt,
    },
  };
}

/**
 * Record a decision verdict onto a session's decision point and advance the
 * chain. Throws when the session or the point is missing (the caller surfaces
 * the message on stderr with exit 1).
 */
export function runDecide(
  projectRoot: string,
  sessionId: string,
  pointId: string,
  options: DecideOptions,
): DecideResult {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) {
    throw new Error(`session not found: ${sessionId}`);
  }

  const prepared = prepareTransitionMutation({
    session: store.readBundle(sessionId).session,
    currentFence: store.readSessionFence(sessionId),
    operation: 'decide',
    subject: { session_id: sessionId, run_id: null, chain_step_id: null },
    payload: {
      point_id: pointId,
      verdict: options.verdict,
      confidence: options.confidence,
      summary: options.summary ?? null,
      evidence: options.evidence ?? null,
    },
    options: options.transition,
  });
  const transitionId = `tr_${randomUUID()}`;
  const appliedAt = localISO();
  const evaluated = store.replayOrApplyTransition(sessionId, prepared.request, draft => {
    if (draft.session.status === 'sealed' || draft.session.status === 'archived') {
      throw new Error(`Session ${sessionId} is ${draft.session.status} and immutable`);
    }
    assertTransitionMutationRevisions(draft.session, prepared.options);
    const leaseConflict = checkLease(draft.session.orchestration.lease, prepared.options.leaseClaim ?? {});
    if (leaseConflict) throw new Error(leaseConflict);
    const result = applyDecideMutation(draft, pointId, options, transitionId, appliedAt);
    return createTransitionOutcome({
      transition_id: transitionId,
      request_id: prepared.request.request_id,
      request_hash: prepared.request.normalized_request_hash,
      operation: 'decide', status: 'applied', applied_at: appliedAt,
      subject: prepared.request.subject,
      postconditions: {
        session_identity_revision: draft.session.identity_revision,
        session_activity_revision: draft.session.activity_revision,
        active_run_id: draft.session.active_run_id,
        run_hash: null,
        artifact_registry_revision: draft.artifacts.revision,
      },
      exit_code: 0, error_code: null, result,
    });
  });
  const projectionPending = !ensureDecisionLogProjection(projectRoot, sessionId, evaluated.outcome.transition_id);
  return {
    ...(structuredClone(evaluated.outcome.result.decision) as DecideAuthorityResult),
    transition: transitionMutationReceipt(prepared.request, evaluated.outcome, evaluated.replayed),
    projection_pending: projectionPending,
  };
}
