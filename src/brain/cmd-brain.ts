// ---------------------------------------------------------------------------
// `maestro brain` subcommand implementations — the deterministic engine the
// authored FSM (.claude/commands/maestro-brain.md) calls each round.
//
//   init         create a brain session + ledger.json
//   derive       print the decision-input snapshot (cursor, stop eval, router signals)
//   decide       run the A_DECIDE engine for a reconciled round-signal (--commit persists)
//   review-plan  enforce review tier (L2 floor) + reviewer != implementer
//   await        suspend until a child session reaches a terminal state
//   status       human-readable session summary
//
// Data contract: `.workflow/.brain/brain-*/ledger.json`. Mirrors src/ralph.
// Exit codes:
//   0 — ok
//   1 — no brain session / no state.json (missing input)
//   2 — usage error (empty intent)
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StateJsonV2 } from '../utils/state-schema.js';
import { deriveBrainState } from './brain-derive.js';
import { type RoundSignal, applyBump, decide } from './brain-decide.js';
import { awaitChildTerminal } from './brain-await.js';
import { selectReviewIsolation, selectTier } from './brain-review.js';
import {
  type ResolvedBrainSession,
  newLedger,
  resolveBrainSession,
  workflowRoot,
  writeLedger,
} from './brain-store.js';
import type { BrainRound } from './brain-schema.js';

function readState(root: string): StateJsonV2 | null {
  try {
    return JSON.parse(readFileSync(join(root, '.workflow', 'state.json'), 'utf-8')) as StateJsonV2;
  } catch {
    return null;
  }
}

function ts(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export interface InitOpts { intent: string; autonomous: boolean; maxRounds?: number; now?: Date; }

export function runInit(opts: InitOpts): number {
  const intent = (opts.intent ?? '').trim();
  if (intent === '') {
    console.error('[brain init] empty intent — refuse to fabricate a roadmap from nothing');
    return 2;
  }
  const root = workflowRoot();
  const sessionId = `brain-${ts(opts.now ?? new Date())}`;
  const ledger = newLedger({ sessionId, intent, autonomous: opts.autonomous, maxRounds: opts.maxRounds });
  const ledgerPath = join(root, '.workflow', '.brain', sessionId, 'ledger.json');
  writeLedger(ledgerPath, ledger);
  console.log(JSON.stringify({ session_id: sessionId, ledger: ledgerPath, stop_condition: ledger.stop_condition }, null, 2));
  return 0;
}

function loadSession(who: string, sessionId?: string): { sess: ResolvedBrainSession; state: StateJsonV2 } | number {
  const root = workflowRoot();
  const sess = resolveBrainSession(root, sessionId);
  if (!sess) {
    console.error(`[brain ${who}] no brain session found`);
    console.error('  → run: maestro brain init "<intent>"');
    return 1;
  }
  const state = readState(root);
  if (!state) {
    console.error(`[brain ${who}] no .workflow/state.json found`);
    console.error('  → run: maestro init');
    return 1;
  }
  return { sess, state };
}

export function runDerive(opts: { sessionId?: string; json?: boolean }): number {
  const loaded = loadSession('derive', opts.sessionId);
  if (typeof loaded === 'number') return loaded;
  const { sess, state } = loaded;
  const bs = deriveBrainState(state, sess.data.blockers);
  if (opts.json) { console.log(JSON.stringify(bs, null, 2)); return 0; }
  console.log(`cursor: ${bs.cursor ?? '(none — all resolved)'}`);
  console.log(`stop satisfied: ${bs.stop.satisfied} -> ${bs.stop.terminalStatus}`);
  console.log(`router: ${JSON.stringify(bs.router)}`);
  return 0;
}

/** Parse `--signal` CLI value into a RoundSignal. e.g. "roadmap-problem:export-semantics". */
export function parseSignal(raw: string | undefined): RoundSignal {
  const v = (raw ?? 'ok').trim();
  if (v === 'ok' || v === 'first-round' || v === 'result-problem' || v === 'unfixable-external') {
    return { kind: v } as RoundSignal;
  }
  if (v.startsWith('roadmap-problem')) {
    const issue = v.includes(':') ? v.slice(v.indexOf(':') + 1) : 'unspecified';
    return { kind: 'roadmap-problem', issue };
  }
  return { kind: 'ok' };
}

export function runDecide(opts: { sessionId?: string; signal?: string; json?: boolean; commit?: boolean }): number {
  const loaded = loadSession('decide', opts.sessionId);
  if (typeof loaded === 'number') return loaded;
  const { sess, state } = loaded;
  const ledger = sess.data;
  const round = ledger.rounds.length + 1;
  const bs = deriveBrainState(state, ledger.blockers);
  const result = decide({
    stop: bs.stop,
    round,
    maxRounds: ledger.max_rounds,
    autonomous: ledger.autonomous,
    cursorUnit: bs.cursor,
    signal: parseSignal(opts.signal),
    convergence: ledger.convergence,
  });

  // --commit PERSISTS the round: apply the convergence bump (so STUCK_CAP/REVISES_CAP
  // actually trip across rounds) and append the round to the ledger audit trail.
  if (opts.commit) {
    if (result.bump) applyBump(ledger.convergence, result.bump);
    const rec: BrainRound = { round, cursor: bs.cursor, decision: result.decision };
    if (result.terminalStatus) ledger.status = result.terminalStatus;
    if (result.giveUp) rec.deferred = [bs.cursor ?? ''];
    ledger.rounds.push(rec);
    writeLedger(sess.ledgerPath, ledger);
  }

  if (opts.json) console.log(JSON.stringify({ round, cursor: bs.cursor, ...result }, null, 2));
  else console.log(`[round ${round}] cursor=${bs.cursor} -> ${result.decision}${result.terminalStatus ? `(${result.terminalStatus})` : ''} :: ${result.reason}`);
  return 0;
}

export interface ReviewPlanOpts {
  difficulty: 'trivial' | 'normal' | 'hard';
  selfReported: boolean; codeChanged: boolean; critical: boolean;
  forcedTier?: 'L1' | 'L2' | 'L3'; implCli: string; clis: string[]; json?: boolean;
}

/** Enforce the brain-specific review decisions (L2-floor + evaluator!=implementer). */
export async function runReviewPlan(opts: ReviewPlanOpts): Promise<number> {
  const tier = selectTier({
    difficulty: opts.difficulty, selfReportedSuccess: opts.selfReported,
    codeChanged: opts.codeChanged, critical: opts.critical, forcedTier: opts.forcedTier,
  });
  const iso = selectReviewIsolation(opts.implCli, opts.clis.length ? opts.clis : [opts.implCli]);
  const out = { tier, reviewCli: iso.reviewCli, isolation: iso.isolation };
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[review-plan] tier=${out.tier} reviewer=${out.reviewCli} (${out.isolation}, != implementer)`);
  return 0;
}

export interface AwaitCliOpts { statusPath: string; kind: 'ralph' | 'odyssey'; timeoutMin?: number; json?: boolean; }

export async function runAwait(opts: AwaitCliOpts): Promise<number> {
  const timeoutMs = (opts.timeoutMin ?? 10) * 60_000;
  const r = await awaitChildTerminal({ statusPath: opts.statusPath, kind: opts.kind, timeoutMs });
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else console.log(`[brain await] ${opts.kind} -> ${r.outcome} (terminal=${r.terminal}, hardSignal=${r.hardSignal}, ${r.elapsedMs}ms)`);
  // exit code: 0 = clean completed, 1 = hard signal (paused/failed/timeout/missing)
  return r.outcome === 'completed' ? 0 : 1;
}

export function runStatus(opts: { sessionId?: string }): number {
  const loaded = loadSession('status', opts.sessionId);
  if (typeof loaded === 'number') return loaded;
  const { sess, state } = loaded;
  const ledger = sess.data;
  const bs = deriveBrainState(state, ledger.blockers);
  console.log(`session: ${ledger.session_id}  status: ${ledger.status}  rounds: ${ledger.rounds.length}/${ledger.max_rounds}`);
  console.log(`cursor: ${bs.cursor ?? '(none)'}  stop: ${bs.stop.satisfied}`);
  console.log(`blockers: ${ledger.blockers.length}  deferred: ${ledger.deferred.length}`);
  return 0;
}

// re-export for callers/tests
export { applyBump };
