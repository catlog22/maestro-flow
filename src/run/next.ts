// ---------------------------------------------------------------------------
// `maestro run next` — thin step driver over a Session's orchestration chain.
//
// Locates the next pending execution step, creates a standard Run for it
// (createRun collects entry gates + upstream), advances the chain step to
// `running`, and emits a compact birth packet pointing the executor at
// `maestro run brief <run_id>`. It deliberately does NOT emit the workflow body
// — that stays behind `run brief`, the single skill-text injection point.
//
// Exit codes mirror `maestro ralph next`:
//   0 — printed a step birth packet
//   2 — no pending execution step (decision node next, or all complete)
//   3 — refused: a step is already running (complete it first)
//   1 — generic error (unresolvable session, ambiguous session, bad content)
//
// src/run must not depend on src/ralph, so the chain helpers live in
// src/run/chain.ts (canonical) rather than being imported from the ralph adapter.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStepContent } from './contract.js';
import { createRun, type PrevHandoff, type RunUpstream } from './runtime.js';
import {
  activeStepIndex,
  nextPendingIndex,
  nextPendingDecisionIndex,
  updateChainStepStatus,
} from './chain.js';
import { SessionStore } from './store.js';
import { readStateJson } from '../utils/state-schema.js';
import type { SessionState, Handoff } from './schemas.js';

export interface NextResult {
  session_id: string;
  run_id: string;
  run_dir: string;
  goal: string;
  step: { index: number; total: number; step_id: string; command: string };
  upstream: Record<string, RunUpstream>;
  entry_gates: { passed: number; failed: number; skipped: number; blocking: number };
  prev_handoff: PrevHandoff | null;
  next: { command: string; reason: string };
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
}

export interface NextOutcome {
  exitCode: number;
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
  | { kind: 'error'; message: string };

/**
 * Session resolution: explicit --session > state.active_session_id > the unique
 * running session that has a pending chain step. Ambiguity (multiple such
 * running sessions) is an error that lists the candidates.
 */
function resolveSession(projectRoot: string, store: SessionStore, sessionId?: string): ResolveResult {
  if (sessionId) {
    if (!store.sessionExists(sessionId)) {
      return { kind: 'error', message: `[run next] session not found: ${sessionId}` };
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
    return { kind: 'error', message: '[run next] no running session with a pending chain step; pass --session <id>' };
  }
  const list = withPending.map(c => `  - ${c.sessionId} (${c.session.intent})`).join('\n');
  return {
    kind: 'error',
    message: `[run next] ambiguous: ${withPending.length} running sessions have pending steps. Pass --session <id>:\n${list}`,
  };
}

// ── Prev handoff (latest_completed_run_id fast path) ─────────────────────────

function prevHandoff(store: SessionStore, session: SessionState): PrevHandoff | null {
  const runId = session.latest_completed_run_id;
  if (!runId) return null;
  let handoff: Handoff | null;
  try {
    handoff = store.readRun(session.session_id, runId).handoff;
  } catch {
    return null;
  }
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

// ── Birth packet rendering ───────────────────────────────────────────────────

function renderBirthPacket(r: NextResult): string {
  const lines: string[] = [];
  lines.push(`## Run ready — step [${r.step.index}/${r.step.total}] ${r.step.command}`);
  lines.push('');
  lines.push(`run_id:  ${r.run_id}`);
  lines.push(`run_dir: ${r.run_dir}`);
  lines.push(`goal:    ${r.goal}`);
  lines.push('');

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

  lines.push(`next: ${r.next.command}`);
  lines.push(`      ${r.next.reason}`);
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
  const chain = session.orchestration.chain;
  let dirty = false;
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (step.status !== 'running' || !step.run_id) continue;
    let runStatus: string | null = null;
    try {
      runStatus = store.readRun(session.session_id, step.run_id).status;
    } catch {
      runStatus = null;
    }
    if (runStatus === 'sealed' || runStatus === 'completed') {
      updateChainStepStatus(projectRoot, session.session_id, i, 'sealed', step.run_id);
      dirty = true;
    }
  }
  return dirty ? store.readBundle(session.session_id).session : session;
}

// ── Core driver ──────────────────────────────────────────────────────────────

export function runNextStep(projectRoot: string, opts: NextCmdOptions = {}): NextOutcome {
  const store = new SessionStore(projectRoot);
  const resolved = resolveSession(projectRoot, store, opts.sessionId);
  if (resolved.kind === 'error') {
    return { exitCode: 1, result: null, message: resolved.message };
  }

  const { sessionId } = resolved;
  let session = resolved.session;

  if (session.status !== 'running') {
    return { exitCode: 1, result: null, message: `[run next] session is "${session.status}", not running` };
  }

  // Reconcile: a chain step whose Run has already sealed is done — advance it so
  // the driver does not stall on a step the executor completed via `run complete`.
  // `run complete` seals the Run without touching the chain, keeping it engine-
  // agnostic; the step-driver owns chain progression.
  session = reconcileSealedSteps(projectRoot, store, session);

  // Refuse when a step is already running — caller must complete it first.
  const runningIdx = activeStepIndex(session);
  if (runningIdx !== null) {
    const step = session.orchestration.chain[runningIdx];
    return {
      exitCode: 3,
      result: null,
      message: [
        `[run next] step ${runningIdx} is still running (command=${step.command})`,
        `  → complete it first: maestro run complete ${step.run_id ?? '<run-id>'} --session ${sessionId}`,
      ].join('\n'),
    };
  }

  const nextIdx = nextPendingIndex(session, true);
  if (nextIdx === null) {
    const decisionIdx = nextPendingDecisionIndex(session);
    if (decisionIdx !== null) {
      const dp = session.orchestration.chain[decisionIdx];
      return {
        exitCode: 2,
        result: null,
        message: [
          `[run next] no pending execution step; next is a decision node: ${dp.decision_ref}`,
          '  → decision nodes are evaluated by the orchestrator, not via run next',
        ].join('\n'),
      };
    }
    return { exitCode: 2, result: null, message: '[run next] no pending steps — all complete' };
  }

  const chainStep = session.orchestration.chain[nextIdx];
  const content = resolveStepContent(projectRoot, chainStep.command);
  if (!content.prepare && !content.workflow) {
    return {
      exitCode: 1,
      result: null,
      message: `[run next] step ${nextIdx} command "${chainStep.command}" has no prepare or workflow content`,
    };
  }

  // Capture the prior step handoff before create advances state.
  const prev = prevHandoff(store, session);

  let created;
  try {
    created = createRun({
      projectRoot,
      command: chainStep.command,
      sessionId,
      intent: session.intent,
      args: opts.args,
    });
  } catch (err) {
    return {
      exitCode: 1,
      result: null,
      message: `[run next] failed to create run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  updateChainStepStatus(projectRoot, sessionId, nextIdx, 'running', created.run_id);

  const result: NextResult = {
    session_id: sessionId,
    run_id: created.run_id,
    run_dir: created.run_dir,
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
    prev_handoff: prev,
    next: created.next,
  };

  return {
    exitCode: 0,
    result,
    message: opts.json ? JSON.stringify(result, null, 2) : renderBirthPacket(result),
  };
}
