// ---------------------------------------------------------------------------
// `maestro run next` — thin step driver over a Session's orchestration chain.
//
// Locates the next pending execution step, creates a standard Run for it
// (createRun collects entry gates + upstream), advances the chain step to
// `running`, and emits a compact birth packet pointing the executor at
// `maestro run brief <run_id>`. It deliberately does NOT emit the workflow body
// — that stays behind `run brief`, the single skill-text injection point.
//
// The birth packet also carries two recommendation blocks (exit 0):
//   - **Queue**    — a preview of the pending steps after the advanced one
//                    (chain-forward view, max 3, decision nodes flagged ◆);
//   - **Recommended** — the prior step's handoff.next[] suggestions.
// When a step is already running (exit 3) it prints a step info card instead of
// a bare refusal; when the next node is a decision it prints a decision card
// (exit 2); a chain-complete session surfaces the prior handoff's next[] as
// `run create` suggestions (exit 2).
//
// `--pick <step_id>` advances a specific pending execution step rather than the
// queue head (parallel groundwork); the single-running guard still wins.
//
// Halt contract: the earliest pending decision node gates every dispatch past
// its chain position (head or --pick) — it must be adjudicated via `run decide`
// before any later step may start.
//
// Exit codes mirror `maestro ralph next`:
//   0 — printed a step birth packet
//   2 — no dispatchable step (decision node gates the chain, or all complete)
//   3 — refused: a step is already running (complete it first)
//   1 — generic error (unresolvable session, ambiguous session, bad content,
//       bad --pick target)
//
// src/run must not depend on src/ralph, so the chain helpers live in
// src/run/chain.ts (canonical) rather than being imported from the ralph adapter.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStepContent } from './contract.js';
import { createRun, resolveArgumentRequirements, type CreateRunResult, type NamedGateBlocker, type PrevHandoff, type RunUpstream } from './runtime.js';
import {
  activeStepIndex,
  nextPendingIndex,
  nextPendingDecisionIndex,
} from './chain.js';
import { checkLease } from './lease.js';
import { SessionStore } from './store.js';
import { readStateJson } from '../utils/state-schema.js';
import type { SessionState, Handoff } from './schemas.js';
import type { TargetPlatform } from '../core/skill-converter.js';

/** Chain-forward preview entry: an upcoming step the orchestrator should expect. */
export interface QueueEntry {
  index: number;
  step_id: string;
  command: string;
  /** True when this queue entry is a decision node (evaluated, not dispatched). */
  is_decision: boolean;
}

/** A prior-step handoff.next[] suggestion surfaced to the orchestrator. */
export interface RecommendedEntry {
  command: string;
  reason: string;
  needs: string[];
}

export interface NextResult {
  session_id: string;
  run_id: string;
  run_dir: string;
  resolved_platform: TargetPlatform;
  /** Verbatim argv persisted on the already-created Run. */
  args: string[];
  argument_requirements: CreateRunResult['argument_requirements'];
  reuse_assessments: CreateRunResult['reuse_assessments'];
  /** Explicit invariant preventing executors from allocating a duplicate Run. */
  run_already_created: true;
  goal: string;
  step: { index: number; total: number; step_id: string; command: string };
  upstream: Record<string, RunUpstream>;
  entry_gates: { passed: number; failed: number; skipped: number; blocking: number };
  /** Bounded named entry blockers; full gate detail remains in `run brief`. */
  blockers: NamedGateBlocker[];
  prev_handoff: PrevHandoff | null;
  /** Prepare-declared deferred-reading refs (path + when). Manifest only. */
  refs: Array<{ path: string; when: string }>;
  brief: { command: string };
  next: { command: string; reason: string };
  /** Pending steps after the advanced one (chain-forward preview, max 3). */
  queue?: QueueEntry[];
  /** Prior step handoff.next[] suggestions (command + reason + needs). */
  recommended?: RecommendedEntry[];
}

export interface NextCmdOptions {
  sessionId?: string;
  json?: boolean;
  /**
   * Command args forwarded to `createRun` (stored in run.command.args). Used by
   * the ralph adapter to carry per-step args from ralph-meta; `run next` leaves
   * this unset so its own behaviour is unchanged.
   */
  args?: string[];
  /**
   * Advance a specific pending execution step (by step_id) rather than the queue
   * head. The target must exist, be `pending`, and be an execution step (not a
   * decision node); otherwise exit 1. The single-running guard still applies.
   */
  pick?: string;
  /**
   * Lease claim checked against session.orchestration.lease before advancing.
   * A null lease (or a lease with a null owner) skips verification entirely, so
   * non-leased sessions are unaffected. A mismatch is exit 1 (mirrors ralph).
   */
  executionOwner?: string;
  ownerEpoch?: number;
  leaseId?: string;
}

export type NextReasonCode =
  | 'DISPATCHED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_AMBIGUOUS'
  | 'SESSION_NOT_RUNNING'
  | 'RESUME_REQUIRED'
  | 'LEASE_CONFLICT'
  | 'RUNNING_STEP'
  | 'DECISION_REQUIRED'
  | 'CHAIN_COMPLETE'
  | 'PICK_NOT_FOUND'
  | 'PICK_NOT_PENDING'
  | 'PICK_DECISION_NODE'
  | 'COMMAND_CONTENT_MISSING'
  | 'ARGUMENT_REQUIRED'
  | 'INTERNAL_ERROR';

export interface NextOutcome {
  exitCode: number;
  reasonCode: NextReasonCode;
  /** Structured result on success (exit 0); null otherwise. */
  result: NextResult | null;
  /** Rendered stdout/stderr text (birth packet on success, message otherwise). */
  message: string;
}

// ── Session resolution ───────────────────────────────────────────────────────

interface SessionCandidate {
  sessionId: string;
  session: SessionState;
}

function listRunningSessions(store: SessionStore): SessionCandidate[] {
  const root = store.sessionsRoot;
  if (!existsSync(root)) return [];
  const candidates: SessionCandidate[] = [];
  const names = readdirSync(root).filter(name => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
  for (const name of names) {
    if (!store.sessionExists(name)) continue;
    try {
      const session = store.readBundle(name).session;
      if (session.status === 'running') candidates.push({ sessionId: name, session });
    } catch {
      /* skip corrupt */
    }
  }
  return candidates;
}

function hasPendingStep(session: SessionState): boolean {
  return nextPendingIndex(session, true) !== null;
}

type ResolveResult =
  | { kind: 'ok'; sessionId: string; session: SessionState }
  | { kind: 'error'; code: Extract<NextReasonCode, 'SESSION_NOT_FOUND' | 'SESSION_AMBIGUOUS' | 'SESSION_NOT_RUNNING'>; message: string };

/**
 * Session resolution: explicit --session > state.active_session_id > the unique
 * running session that has a pending chain step. Ambiguity (multiple such
 * running sessions) is an error that lists the candidates.
 */
function resolveSession(projectRoot: string, store: SessionStore, sessionId?: string): ResolveResult {
  if (sessionId) {
    if (!store.sessionExists(sessionId)) {
      return { kind: 'error', code: 'SESSION_NOT_FOUND', message: `[run next] session not found: ${sessionId}` };
    }
    return { kind: 'ok', sessionId, session: store.readBundle(sessionId).session };
  }

  const state = readStateJson(projectRoot);
  const active = state?.active_session_id;
  if (active && store.sessionExists(active)) {
    try {
      const session = store.readBundle(active).session;
      if (session.status === 'running') return { kind: 'ok', sessionId: active, session };
    } catch {
      /* fall through to scan */
    }
  }

  const running = listRunningSessions(store);
  const withPending = running.filter(c => hasPendingStep(c.session));
  if (withPending.length === 1) {
    return { kind: 'ok', sessionId: withPending[0].sessionId, session: withPending[0].session };
  }
  if (withPending.length === 0) {
    return { kind: 'error', code: 'SESSION_NOT_RUNNING', message: '[run next] no running session with a pending chain step; pass --session <id>' };
  }
  const list = withPending.map(c => `  - ${c.sessionId} (${c.session.intent})`).join('\n');
  return {
    kind: 'error',
    code: 'SESSION_AMBIGUOUS',
    message: `[run next] ambiguous: ${withPending.length} running sessions have pending steps. Pass --session <id>:\n${list}`,
  };
}

// ── Prev handoff (latest_completed_run_id fast path) ─────────────────────────

/** Full handoff of the latest completed Run, or null when unreadable/absent. */
function latestHandoff(store: SessionStore, session: SessionState): Handoff | null {
  const runId = session.latest_completed_run_id;
  if (!runId) return null;
  try {
    return store.readRun(session.session_id, runId).handoff;
  } catch {
    return null;
  }
}

function toPrevHandoff(handoff: Handoff | null): PrevHandoff | null {
  if (!handoff) return null;
  return {
    run_id: handoff.producer_run_id,
    command: handoff.command,
    verdict: handoff.verdict,
    summary: handoff.summary,
    decisions: handoff.decisions.map(d => d.text),
    concerns: handoff.concerns,
  };
}

/** handoff.next[] suggestions as a recommendation list (empty when none). */
function recommendedFrom(handoff: Handoff | null): RecommendedEntry[] {
  if (!handoff || handoff.next.length === 0) return [];
  return handoff.next.map(n => ({ command: n.command, reason: n.reason, needs: n.needs }));
}

// ── Queue preview (chain-forward pending steps after the advanced one) ────────

/**
 * Pending steps after `afterIdx` (exclusive) as a chain-forward preview. Both
 * execution and decision steps are listed (decision nodes flagged) so the
 * orchestrator can see what is coming; capped at `limit` entries.
 */
function buildQueue(session: SessionState, afterIdx: number, limit = 3): QueueEntry[] {
  const chain = session.orchestration.chain;
  const queue: QueueEntry[] = [];
  for (let i = afterIdx + 1; i < chain.length && queue.length < limit; i++) {
    const step = chain[i];
    if (step.status !== 'pending') continue;
    queue.push({
      index: i,
      step_id: step.step_id,
      command: step.command,
      is_decision: Boolean(step.decision_ref),
    });
  }
  return queue;
}

// ── Birth packet rendering ───────────────────────────────────────────────────

function renderQueueSection(queue: QueueEntry[]): string[] {
  if (queue.length === 0) return [];
  const lines = ['**Queue（后续步骤）**:'];
  for (const q of queue) {
    const mark = q.is_decision ? ' ◆' : '';
    lines.push(`- [${q.index}] ${q.command}${mark}`);
  }
  lines.push('');
  return lines;
}

function renderRecommendedSection(recommended: RecommendedEntry[]): string[] {
  if (recommended.length === 0) return [];
  const lines = ['**Recommended（建议）**:'];
  for (const r of recommended) {
    const needs = r.needs.length > 0 ? ` (needs: ${r.needs.join(', ')})` : '';
    const reason = r.reason ? ` — ${r.reason}` : '';
    lines.push(`- ${r.command}${reason}${needs}`);
  }
  lines.push('');
  return lines;
}

function renderBirthPacket(r: NextResult): string {
  const lines: string[] = [];
  lines.push(`## Run ready — step [${r.step.index}/${r.step.total}] ${r.step.command}`);
  lines.push('');
  lines.push(`run_id:  ${r.run_id}`);
  lines.push(`run_dir: ${r.run_dir}`);
  lines.push(`args:    ${JSON.stringify(r.args)}`);
  lines.push('run_already_created: true (do not call maestro run create)');
  lines.push(`goal:    ${r.goal}`);
  lines.push('');

  const missingArguments = r.argument_requirements.filter(item => item.missing);
  if (missingArguments.length > 0) {
    lines.push('**Required arguments**:');
    for (const item of missingArguments) lines.push(`- BLOCKER ${item.name}: ${item.question}`);
    lines.push('');
  }

  const upstreamKeys = Object.keys(r.upstream);
  if (upstreamKeys.length > 0) {
    lines.push('**Upstream inputs**:');
    for (const alias of upstreamKeys) {
      const u = r.upstream[alias];
      lines.push(`- ${alias} → ${u.path} (${u.kind}, ${u.status})`);
    }
  } else {
    lines.push('**Upstream inputs**: (none)');
  }
  lines.push('');

  const g = r.entry_gates;
  lines.push(`**Entry gates**: ${g.passed} passed, ${g.failed} failed, ${g.skipped} skipped, ${g.blocking} blocking`);
  for (const blocker of r.blockers) {
    lines.push(`- BLOCKER ${blocker.gate_id}: ${blocker.title} (${blocker.status})`);
  }
  lines.push('');

  if (r.prev_handoff) {
    const p = r.prev_handoff;
    lines.push(`**Previous step** (${p.run_id}, ${p.verdict}):`);
    lines.push(`- ${p.summary || '(no summary)'}`);
    if (p.concerns.length > 0) {
      lines.push(`- ⚠️ concerns: ${p.concerns.join('; ')}`);
    }
    lines.push('');
  }

  if (r.refs.length > 0) {
    lines.push('**按需参考（Read when needed）**:');
    for (const ref of r.refs) {
      lines.push(ref.when ? `- ${ref.path} — ${ref.when}` : `- ${ref.path}`);
    }
    lines.push('');
  }

  lines.push(...renderQueueSection(r.queue ?? []));
  lines.push(...renderRecommendedSection(r.recommended ?? []));

  lines.push(`next: ${r.next.command}`);
  lines.push(`      ${r.next.reason}`);
  return lines.join('\n');
}

// ── Running / decision cards (non-advance branches) ───────────────────────────

/**
 * Step info card for the running-step guard (exit 3). Reads the Run for its
 * run_dir / started_at (gracefully degrading when unreadable) and points the
 * executor at `run brief` (re-inject context) / `run complete` (finish the step).
 */
function renderRunningCard(
  store: SessionStore,
  session: SessionState,
  sessionId: string,
  runningIdx: number,
): string {
  const step = session.orchestration.chain[runningIdx];
  const total = session.orchestration.chain.length;
  const runId = step.run_id;

  let runDir: string | null = null;
  let startedAt: string | null = null;
  if (runId) {
    try {
      const run = store.readRun(sessionId, runId);
      runDir = store.runDir(sessionId, runId);
      startedAt = run.started_at;
    } catch {
      /* degrade gracefully — the card still shows the chain-side facts */
    }
  }

  const lines: string[] = [];
  lines.push(`## Step running — step [${runningIdx}/${total}] ${step.command}`);
  lines.push('');
  lines.push(`step_id:  ${step.step_id}`);
  lines.push(`run_id:   ${runId ?? '<unknown>'}`);
  lines.push(`run_dir:  ${runDir ?? '<unreadable>'}`);
  if (startedAt) lines.push(`started:  ${startedAt}`);
  lines.push(`goal:     ${session.intent}`);
  lines.push('');
  lines.push('**如何调用**:');
  lines.push(`- 继续执行/重新注入上下文: maestro run brief ${runId ?? '<run-id>'} --session ${sessionId}`);
  lines.push(`- 完成本步: maestro run complete ${runId ?? '<run-id>'} --session ${sessionId}`);
  return lines.join('\n');
}

/**
 * Decision card for the decision-node branch (exit 2). Surfaces the matching
 * decision_points entry so the orchestrator (prompt layer) has the point_id /
 * retry budget / evidence in hand when it evaluates the gate.
 */
function renderDecisionCard(session: SessionState, decisionIdx: number): string {
  const dp = session.orchestration.chain[decisionIdx];
  const point = session.orchestration.decision_points.find(p => p.point_id === dp.decision_ref);

  const lines: string[] = [];
  lines.push(`## Decision node — ${dp.decision_ref}`);
  lines.push('');
  lines.push(`step_id:      ${dp.step_id}`);
  lines.push(`decision_ref: ${dp.decision_ref}`);
  if (point) {
    lines.push(`point_id:     ${point.point_id}`);
    lines.push(`after_step:   ${point.after_step_id ?? '<none>'}`);
    lines.push(`status:       ${point.status}`);
    lines.push(`retries:      ${point.retry_count}/${point.max_retries}`);
    lines.push(`evidence:     ${point.evidence_ref ?? '<none>'}`);
  } else {
    lines.push('  (no matching decision_points entry)');
  }
  lines.push('');
  lines.push('→ decision 由编排器（prompt 层）评估裁决，不经 run next 推进');
  return lines.join('\n');
}

// ── Chain reconciliation ─────────────────────────────────────────────────────

/**
 * Advance any chain step marked `running` whose Run has already sealed. Returns
 * the (possibly re-read) session. Runs a single store write only when something
 * changed, so the common no-op path stays cheap.
 */
function reconcileSealedSteps(
  projectRoot: string,
  store: SessionStore,
  session: SessionState,
): SessionState {
  const candidates: Array<{ stepId: string; runId: string }> = [];
  for (const step of session.orchestration.chain) {
    if (step.status !== 'running' || !step.run_id) continue;
    let runStatus: string | null = null;
    try {
      runStatus = store.readRun(session.session_id, step.run_id).status;
    } catch {
      runStatus = null;
    }
    if (runStatus === 'sealed' || runStatus === 'completed') {
      candidates.push({ stepId: step.step_id, runId: step.run_id });
    }
  }
  if (candidates.length === 0) return session;

  // The pre-scan is only a cheap locator. Re-read both the chain step and Run
  // while holding the SessionStore lock, then apply a step_id + run_id + status
  // CAS. This prevents a concurrent needs-retry verdict from being overwritten
  // by a stale sealed-Run snapshot.
  store.update(session.session_id, (draft, tx) => {
    let dirty = false;
    for (const candidate of candidates) {
      const step = draft.session.orchestration.chain.find(s => s.step_id === candidate.stepId);
      if (!step || step.status !== 'running' || step.run_id !== candidate.runId) continue;
      let runStatus: string | null = null;
      try {
        runStatus = tx.readRun(candidate.runId).status;
      } catch {
        runStatus = null;
      }
      if (runStatus !== 'sealed' && runStatus !== 'completed') continue;
      step.status = 'sealed';
      dirty = true;
    }
    if (dirty) draft.session.activity_revision++;
    return null;
  });
  return store.readBundle(session.session_id).session;
}

// ── --pick target resolution ──────────────────────────────────────────────────

type PickResult =
  | { kind: 'ok'; index: number }
  | { kind: 'error'; message: string };

/**
 * Resolve a `--pick <step_id>` target to its chain index. The step must exist,
 * be `pending`, and be an execution step (not a decision node); otherwise the
 * error lists the pickable pending execution step_ids.
 */
function resolvePick(session: SessionState, pick: string): PickResult {
  const chain = session.orchestration.chain;
  const idx = chain.findIndex(s => s.step_id === pick);
  const pending = chain
    .filter(s => s.status === 'pending' && !s.decision_ref)
    .map(s => s.step_id);
  const pickable = pending.length > 0 ? `\n  pending steps: ${pending.join(', ')}` : '\n  (no pending execution steps)';

  if (idx === -1) {
    return { kind: 'error', message: `[run next] --pick step not found: ${pick}${pickable}` };
  }
  const step = chain[idx];
  if (step.decision_ref) {
    return { kind: 'error', message: `[run next] --pick step "${pick}" is a decision node, not an execution step${pickable}` };
  }
  if (step.status !== 'pending') {
    return { kind: 'error', message: `[run next] --pick step "${pick}" is "${step.status}", not pending${pickable}` };
  }
  return { kind: 'ok', index: idx };
}

// ── Core driver ──────────────────────────────────────────────────────────────

export function runNextStep(projectRoot: string, opts: NextCmdOptions = {}): NextOutcome {
  const store = new SessionStore(projectRoot);
  const resolved = resolveSession(projectRoot, store, opts.sessionId);
  if (resolved.kind === 'error') {
    return { exitCode: 1, reasonCode: resolved.code, result: null, message: resolved.message };
  }

  const { sessionId } = resolved;
  let session = resolved.session;

  // Lease guard (§1.4): a leased session refuses advancement unless the claim
  // matches. Inert for null-lease sessions, so it also replaces the old engine
  // filter — the gate is the lease itself, not the engine tag.
  const conflict = checkLease(session.orchestration.lease, {
    executionOwner: opts.executionOwner,
    ownerEpoch: opts.ownerEpoch,
    leaseId: opts.leaseId,
  });
  if (conflict) {
    return { exitCode: 1, reasonCode: 'LEASE_CONFLICT', result: null, message: `[run next] ${conflict}` };
  }

  if (session.status !== 'running') {
    const escalated = session.orchestration.decision_points
      .filter(point => point.status === 'escalated')
      .map(point => point.point_id);
    const detail = escalated.length > 0 ? `; escalated decisions: ${escalated.join(', ')}` : '';
    return {
      exitCode: 1,
      reasonCode: 'RESUME_REQUIRED',
      result: null,
      message: `[run next] session is "${session.status}"; dispatch refused${detail}. `
        + 'Resolve the blocker/escalation and perform an authorized resume transition before retrying run next.',
    };
  }
  if (session.active_run_id && activeStepIndex(session) === null) {
    return {
      exitCode: 3,
      reasonCode: 'RUNNING_STEP',
      result: null,
      message: `[run next] Session ${sessionId} already has active Run ${session.active_run_id}; `
        + `inspect it with: maestro run brief ${session.active_run_id} --session ${sessionId}`,
    };
  }

  // Reconcile: a chain step whose Run has already sealed is done — advance it so
  // the driver does not stall on a step the executor completed via `run complete`.
  // `run complete` seals the Run without touching the chain, keeping it engine-
  // agnostic; the step-driver owns chain progression.
  session = reconcileSealedSteps(projectRoot, store, session);

  // Refuse when a step is already running — caller must complete it first. The
  // single-running guard wins over --pick.
  const runningIdx = activeStepIndex(session);
  if (runningIdx !== null) {
    return {
      exitCode: 3,
      reasonCode: 'RUNNING_STEP',
      result: null,
      message: renderRunningCard(store, session, sessionId, runningIdx),
    };
  }

  // Resolve which pending step to advance: --pick target when given, else queue
  // head. A decision node next (no pending execution step) prints a decision card.
  let nextIdx: number;
  if (opts.pick) {
    const picked = resolvePick(session, opts.pick);
    if (picked.kind === 'error') {
      const reasonCode = picked.message.includes('not found')
        ? 'PICK_NOT_FOUND'
        : picked.message.includes('decision node')
          ? 'PICK_DECISION_NODE'
          : 'PICK_NOT_PENDING';
      return { exitCode: 1, reasonCode, result: null, message: picked.message };
    }
    nextIdx = picked.index;
  } else {
    const head = nextPendingIndex(session, true);
    if (head === null) {
      const decisionIdx = nextPendingDecisionIndex(session);
      if (decisionIdx !== null) {
        return { exitCode: 2, reasonCode: 'DECISION_REQUIRED', result: null, message: renderDecisionCard(session, decisionIdx) };
      }
      // Chain complete: surface the prior handoff's next[] as `run create`
      // suggestions when present (covers empty-chain sessions too).
      return { exitCode: 2, reasonCode: 'CHAIN_COMPLETE', result: null, message: renderAllCompleteMessage(store, session, sessionId) };
    }
    nextIdx = head;
  }

  // Halt contract: an unresolved decision node earlier in the chain gates every
  // dispatch past it (head or --pick) — the orchestrator must adjudicate it via
  // `run decide` before any later step may start.
  const gateIdx = nextPendingDecisionIndex(session);
  if (gateIdx !== null && gateIdx < nextIdx) {
    return { exitCode: 2, reasonCode: 'DECISION_REQUIRED', result: null, message: renderDecisionCard(session, gateIdx) };
  }

  const chainStep = session.orchestration.chain[nextIdx];
  const content = resolveStepContent(projectRoot, chainStep.command);
  if (!content.prepare && !content.workflow) {
    return {
      exitCode: 1,
      reasonCode: 'COMMAND_CONTENT_MISSING',
      result: null,
      message: `[run next] step ${nextIdx} command "${chainStep.command}" has no prepare or workflow content`,
    };
  }

  // Capture the prior step handoff before create advances state.
  const handoff = latestHandoff(store, session);
  const prev = toPrevHandoff(handoff);
  const recommended = recommendedFrom(handoff);
  const queue = buildQueue(session, nextIdx);
  const args = opts.args ?? (chainStep.args ? [chainStep.args] : []);
  const argumentRequirements = resolveArgumentRequirements(projectRoot, chainStep.command, args);
  const missingArguments = argumentRequirements.filter(item => item.required && item.missing);
  if (missingArguments.length > 0) {
    return {
      exitCode: 1,
      reasonCode: 'ARGUMENT_REQUIRED',
      result: null,
      message: `[run next] missing required arguments for ${chainStep.command}: `
        + missingArguments.map(item => `${item.name}: ${item.question}`).join('; '),
    };
  }

  let created;
  try {
    created = createRun({
      projectRoot,
      command: chainStep.command,
      sessionId,
      intent: session.intent,
      topic: session.topic_identity?.verbatim ?? session.intent,
      args,
      chainStepId: chainStep.step_id,
      expectedActivityRevision: session.activity_revision,
      expectedIdentityRevision: session.identity_revision,
      retryToken: chainStep.pending_retry?.token,
      leaseClaim: {
        executionOwner: opts.executionOwner,
        ownerEpoch: opts.ownerEpoch,
        leaseId: opts.leaseId,
      },
    });
  } catch (err) {
    const current = store.readBundle(sessionId).session;
    const concurrentRunning = activeStepIndex(current);
    if (concurrentRunning !== null) {
      return { exitCode: 3, reasonCode: 'RUNNING_STEP', result: null, message: renderRunningCard(store, current, sessionId, concurrentRunning) };
    }
    return {
      exitCode: 1,
      reasonCode: 'INTERNAL_ERROR',
      result: null,
      message: `[run next] failed to create run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result: NextResult = {
    session_id: sessionId,
    run_id: created.run_id,
    run_dir: created.run_dir,
    resolved_platform: created.resolved_platform,
    args,
    argument_requirements: created.argument_requirements,
    reuse_assessments: created.reuse_assessments,
    run_already_created: true,
    goal: session.intent,
    step: {
      index: nextIdx,
      total: session.orchestration.chain.length,
      step_id: chainStep.step_id,
      command: chainStep.command,
    },
    upstream: created.upstream,
    entry_gates: {
      passed: created.entry_gates.passed.length,
      failed: created.entry_gates.failed.length,
      skipped: created.entry_gates.skipped.length,
      blocking: created.entry_gates.blocking.length,
    },
    blockers: created.entry_blockers,
    prev_handoff: prev,
    refs: content.refs,
    brief: { command: created.next.command },
    next: created.next,
    queue,
    recommended,
  };

  return {
    exitCode: 0,
    reasonCode: 'DISPATCHED',
    result,
    message: opts.json ? JSON.stringify(result, null, 2) : renderBirthPacket(result),
  };
}

/**
 * The "all complete" message (exit 2), optionally extended with `run create`
 * suggestions from the last completed step's handoff.next[]. An empty chain
 * takes this path too, so a chain-less session still gets recommendations.
 */
function renderAllCompleteMessage(store: SessionStore, session: SessionState, sessionId: string): string {
  const recommended = recommendedFrom(latestHandoff(store, session));
  const lines = ['[run next] no pending steps — all complete'];
  for (const r of recommended) {
    const reason = r.reason ? ` — ${r.reason}` : '';
    lines.push(`  suggested: maestro run create ${r.command} --session ${sessionId}${reason}`);
  }
  return lines.join('\n');
}
