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
// --summary / --evidence land on decision_point.evidence_ref (the schema field
// designed for it) and append a record to the FSM's existing decision log
// `{session_dir}/decisions.ndjson` (see A_AGENT_EVALUATE step 7), keeping the CLI
// write on the same persistence surface the prompt layer already reads.
//
// All state writes go through SessionStore.update; the decisions.ndjson append is
// a best-effort side write (never fails the verdict — the store write is truth).
//
// src/run must never import src/ralph — this lives here so the ralph adapter can
// reuse it (direction ralph → run only).
// ---------------------------------------------------------------------------

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from './store.js';
import { localISO } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

export type DecisionVerdict = 'proceed' | 'fix' | 'escalate';
export type DecisionConfidence = 'high' | 'medium' | 'low';

export interface DecideOptions {
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  summary?: string;
  /** Evidence path/reference recorded on decision_point.evidence_ref. */
  evidence?: string;
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
  next: { command: string; reason: string };
}

/** Index of the chain decision node referencing this point, or -1. */
function chainDecisionNodeIndex(session: SessionState, pointId: string): number {
  return session.orchestration.chain.findIndex(step => step.decision_ref === pointId);
}

/**
 * The next-step pointer after a decision is recorded. A paused session (escalate)
 * points at resuming; otherwise `run next` continues the chain.
 */
function decideNextPointer(
  session: SessionState,
  verdict: DecisionVerdict,
): { command: string; reason: string } {
  const sessionId = session.session_id;
  if (verdict === 'escalate') {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'session paused (escalated) — human intervention, then resume',
    };
  }
  if (verdict === 'fix') {
    return {
      command: `maestro session chain insert --session ${sessionId} --after <step_id|index> --command <fix-command>`,
      reason: 'fix verdict — insert repair step(s), then advance with maestro run next',
    };
  }
  return {
    command: `maestro run next --session ${sessionId}`,
    reason: 'decision passed — advance the chain',
  };
}

/**
 * Append a decision record to `{session_dir}/decisions.ndjson` — the same log
 * the FSM's A_AGENT_EVALUATE writes to. Best-effort: a write failure never
 * changes the verdict outcome (the store write already committed).
 */
function appendDecisionLog(
  sessionDir: string,
  record: Record<string, unknown>,
): void {
  try {
    mkdirSync(sessionDir, { recursive: true });
    appendFileSync(join(sessionDir, 'decisions.ndjson'), JSON.stringify(record) + '\n', 'utf8');
  } catch {
    /* best-effort — the store write is the source of truth */
  }
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

  const evidenceRef = options.evidence?.trim() || options.summary?.trim() || null;

  const result = store.update(sessionId, (draft) => {
    const orch = draft.session.orchestration;
    const point = orch.decision_points.find(p => p.point_id === pointId);
    if (!point) {
      const known = orch.decision_points.map(p => p.point_id).join(', ') || '(none)';
      throw new Error(`decision point not found: ${pointId} (known: ${known})`);
    }

    const nodeIdx = chainDecisionNodeIndex(draft.session, pointId);
    const node = nodeIdx >= 0 ? orch.chain[nodeIdx] : null;

    let retry: DecideResult['retry'] = null;
    switch (options.verdict) {
      case 'proceed':
        point.status = 'passed';
        // Seal the chain decision node so nextPendingIndex / nextPendingDecisionIndex
        // step past it — the same terminal state reconcileSealedSteps uses.
        if (node) node.status = 'sealed';
        break;
      case 'fix': {
        point.retry_count += 1;
        // status stays 'pending' (待决); ceiling is a prompt-layer decision.
        retry = {
          count: point.retry_count,
          max: point.max_retries,
          exhausted: point.retry_count >= point.max_retries,
        };
        break;
      }
      case 'escalate':
        point.status = 'escalated';
        draft.session.status = 'paused';
        // The decision node stays pending so resuming re-surfaces it.
        break;
    }

    if (evidenceRef !== null) point.evidence_ref = evidenceRef;
    draft.session.activity_revision++;

    return {
      point_status: point.status,
      retry,
      chain: node ? { step_id: node.step_id, index: nodeIdx, step_status: node.status } : null,
      session_status: draft.session.status,
    };
  });

  appendDecisionLog(store.sessionDir(sessionId), {
    type: 'decide',
    point_id: pointId,
    verdict: options.verdict,
    confidence: options.confidence,
    summary: options.summary ?? null,
    evidence_ref: evidenceRef,
    retry_count: result.retry?.count ?? null,
    timestamp: localISO(),
  });

  const after = store.readBundle(sessionId).session;
  return {
    session_id: sessionId,
    point_id: pointId,
    verdict: options.verdict,
    confidence: options.confidence,
    point_status: result.point_status,
    retry: result.retry,
    chain: result.chain,
    session_status: result.session_status,
    next: decideNextPointer(after, options.verdict),
  };
}
