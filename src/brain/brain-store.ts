// ---------------------------------------------------------------------------
// Brain store — locates the brain session dir and reads/writes ledger.json.
// Atomic write via `.tmp` + rename (same discipline as src/ralph/status-store).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type BrainLedger,
  DEFAULT_AWAIT_TIMEOUT_MIN,
  DEFAULT_MAX_ROUNDS,
  newConvergence,
} from './brain-schema.js';

export interface ResolvedBrainSession {
  sessionId: string;
  sessionDir: string;
  ledgerPath: string;
  data: BrainLedger;
}

function brainRoot(workflowRoot: string): string {
  return join(workflowRoot, '.workflow', '.brain');
}

export function listBrainSessions(workflowRoot: string): string[] {
  const root = brainRoot(workflowRoot);
  if (!existsSync(root)) return [];
  const entries: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith('brain-')) continue;
    try {
      const st = statSync(join(root, name));
      if (st.isDirectory()) entries.push({ name, mtimeMs: st.mtimeMs });
    } catch { /* ignore */ }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.map(e => e.name);
}

export function resolveBrainSession(workflowRoot: string, sessionId?: string): ResolvedBrainSession | null {
  const root = brainRoot(workflowRoot);
  if (sessionId) {
    const ledgerPath = join(root, sessionId, 'ledger.json');
    if (!existsSync(ledgerPath)) return null;
    return { sessionId, sessionDir: join(root, sessionId), ledgerPath, data: readLedger(ledgerPath) };
  }
  for (const name of listBrainSessions(workflowRoot)) {
    const ledgerPath = join(root, name, 'ledger.json');
    if (!existsSync(ledgerPath)) continue;
    try {
      return { sessionId: name, sessionDir: join(root, name), ledgerPath, data: readLedger(ledgerPath) };
    } catch { /* skip corrupt */ }
  }
  return null;
}

export function readLedger(ledgerPath: string): BrainLedger {
  return JSON.parse(readFileSync(ledgerPath, 'utf-8')) as BrainLedger;
}

/** Atomic write: stage to `.tmp`, then rename. Creates parent dir if needed. */
export function writeLedger(ledgerPath: string, data: BrainLedger): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const tmp = `${ledgerPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, ledgerPath);
}

export function workflowRoot(): string {
  return resolve(process.cwd());
}

export interface NewLedgerOpts {
  sessionId: string;
  intent: string;
  autonomous: boolean;
  maxRounds?: number;
  mode?: BrainLedger['mode'];
  executorDefault?: string;
  availableClis?: string[];
}

export function newLedger(opts: NewLedgerOpts): BrainLedger {
  return {
    session_id: opts.sessionId,
    intent: opts.intent,
    autonomous: opts.autonomous,
    max_rounds: opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
    await_timeout_min: DEFAULT_AWAIT_TIMEOUT_MIN,
    mode: opts.mode ?? 'skill-only',
    executor_default: opts.executorDefault ?? 'claude',
    available_clis: opts.availableClis ?? [],
    stop_condition: 'all MANDATORY milestones completed; OPTIONAL completed-or-acknowledged-deferred',
    stop_predicate: {
      mandatory_all_completed: false,
      optional_all_resolved: false,
      no_open_defect_blocker: true,
      no_open_mandatory_deferred: true,
    },
    key_decisions: [],
    blockers: [],
    deferred: [],
    convergence: newConvergence(),
    rounds: [],
    status: 'running',
  };
}
