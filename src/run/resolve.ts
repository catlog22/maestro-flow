// ---------------------------------------------------------------------------
// Session resolution shared by the免参 (run-id-less) run verbs. `run complete`
// without a run-id must locate the Run bound to the session's active chain step;
// this resolves the session the same way `run next` does — explicit --session >
// state.active_session_id > the unique running session that has a running chain
// step with a run_id — then returns that step's run_id.
//
// It deliberately mirrors (not imports) next.ts's resolveSession so the M3 next
// logic stays untouched. The distinction: next resolves on a *pending* step,
// complete resolves on a *running* step (the one awaiting completion).
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from './store.js';
import { readStateJson } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

export interface RunningStep {
  index: number;
  step_id: string;
  command: string;
  run_id: string;
}

/** The single running chain step that has a bound run_id, or null. */
export function runningChainStep(session: SessionState): RunningStep | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (step.status === 'running' && step.run_id) {
      return { index: i, step_id: step.step_id, command: step.command, run_id: step.run_id };
    }
  }
  return null;
}

interface SessionCandidate {
  sessionId: string;
  session: SessionState;
}

function listRunningSessions(store: SessionStore): SessionCandidate[] {
  const root = store.sessionsRoot;
  if (!existsSync(root)) return [];
  const candidates: SessionCandidate[] = [];
  for (const name of readdirSync(root)) {
    try {
      if (!statSync(join(root, name)).isDirectory()) continue;
    } catch {
      continue;
    }
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

export type ResolveRunResult =
  | { kind: 'ok'; sessionId: string; session: SessionState; step: RunningStep }
  | { kind: 'error'; message: string };

/**
 * Resolve the Run to complete when no run-id is supplied. Session resolution
 * order matches `run next`; within the session, the running chain step with a
 * run_id is the target. Errors list the candidates / point at passing a run-id.
 */
export function resolveRunningRun(
  projectRoot: string,
  store: SessionStore,
  sessionId?: string,
): ResolveRunResult {
  if (sessionId) {
    if (!store.sessionExists(sessionId)) {
      return { kind: 'error', message: `[run complete] session not found: ${sessionId}` };
    }
    const session = store.readBundle(sessionId).session;
    const step = runningChainStep(session);
    if (!step) {
      return {
        kind: 'error',
        message: `[run complete] session ${sessionId} has no running chain step; pass a run-id explicitly`,
      };
    }
    return { kind: 'ok', sessionId, session, step };
  }

  const state = readStateJson(projectRoot);
  const active = state?.active_session_id;
  if (active && store.sessionExists(active)) {
    try {
      const session = store.readBundle(active).session;
      const step = runningChainStep(session);
      if (session.status === 'running' && step) {
        return { kind: 'ok', sessionId: active, session, step };
      }
    } catch {
      /* fall through to scan */
    }
  }

  const running = listRunningSessions(store);
  const withRunning = running
    .map(c => ({ ...c, step: runningChainStep(c.session) }))
    .filter((c): c is SessionCandidate & { step: RunningStep } => c.step !== null);

  if (withRunning.length === 1) {
    const only = withRunning[0];
    return { kind: 'ok', sessionId: only.sessionId, session: only.session, step: only.step };
  }
  if (withRunning.length === 0) {
    return {
      kind: 'error',
      message: '[run complete] no running session with a running chain step; pass a run-id or --session <id>',
    };
  }
  const list = withRunning.map(c => `  - ${c.sessionId} (${c.session.intent})`).join('\n');
  return {
    kind: 'error',
    message: `[run complete] ambiguous: ${withRunning.length} running sessions have an active step. Pass --session <id>:\n${list}`,
  };
}
