// ---------------------------------------------------------------------------
// Child-session await — SUSPEND until a child session reaches a terminal state,
// event-driven (fs.watch), NOT busy-polling. Claude-only (the child is a Claude
// ralph/odyssey session; Codex is out of scope per the engineering decision).
//
// Modeled on the Agent SDK `receive_response()` idiom (block per-event, no spin):
// the process suspends on a filesystem-change event and only re-reads the child
// status file when it actually changes, with a coarse safety floor (fs.watch can
// coalesce/miss events) and a hard timeout (command v7 await_timeout).
//
// Terminal fields are the real ones validated in v8 against source:
//   ralph   .workflow/.maestro/ralph-*/status.json  (status-schema.ts:13,100,132)
//   odyssey .workflow/scratch/.../session.json       (odyssey-base.md:33,35,196)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_AWAIT_FLOOR_SEC } from './brain-schema.js';

export type ChildKind = 'ralph' | 'odyssey';

export type AwaitOutcome =
  | 'completed'   // success terminal
  | 'paused'      // ralph hard signal (drift / remediation exhausted)
  | 'failed'      // ralph hard signal (crash/error)
  | 'timeout'     // deadline hit, never terminal -> hard signal
  | 'missing';    // status file never appeared -> hard signal

export interface ChildClassification {
  terminal: boolean;     // reached completed | paused | failed
  outcome: Exclude<AwaitOutcome, 'timeout' | 'missing'>;
  hardSignal: boolean;   // paused | failed -> route to S_VERDICT hard-signal branch
}

/**
 * Classify a parsed child status object using the REAL terminal-field semantics.
 * Unknown / "running" / missing fields => NOT terminal (never false-green).
 */
export function classifyChildStatus(raw: unknown, kind: ChildKind): ChildClassification | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (kind === 'ralph') {
    const status = o.status;
    if (status === 'completed' && o.task_decomposition_all_done === true) {
      return { terminal: true, outcome: 'completed', hardSignal: false };
    }
    if (status === 'completed' && o.task_decomposition_all_done !== true) {
      // session says completed but sub-goals not all confirmed -> treat as hard signal, never silent-pass
      return { terminal: true, outcome: 'paused', hardSignal: true };
    }
    if (status === 'paused') return { terminal: true, outcome: 'paused', hardSignal: true };
    if (status === 'failed') return { terminal: true, outcome: 'failed', hardSignal: true };
    return null; // running / unknown -> not terminal
  }

  // odyssey: no status enum; terminal = current_state === 'COMPLETED' or phase_goals_all_done
  if (o.current_state === 'COMPLETED' || o.phase_goals_all_done === true) {
    return { terminal: true, outcome: 'completed', hardSignal: false };
  }
  return null;
}

export interface AwaitOpts {
  statusPath: string;
  kind: ChildKind;
  timeoutMs: number;          // hard deadline (await_timeout)
  floorSec?: number;          // safety re-check floor (seconds) for missed fs.watch events; default DEFAULT_AWAIT_FLOOR_SEC (2)
  now?: () => number;         // injectable clock for tests
}

export interface AwaitResult {
  outcome: AwaitOutcome;
  terminal: boolean;
  hardSignal: boolean;
  raw: unknown;
  elapsedMs: number;
}

function readChild(statusPath: string): unknown {
  try {
    return JSON.parse(readFileSync(statusPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * SUSPEND until the child reaches a terminal state or the deadline passes.
 * Resolves (never rejects) so the caller can route the outcome deterministically.
 */
export function awaitChildTerminal(opts: AwaitOpts): Promise<AwaitResult> {
  const clock = opts.now ?? (() => Date.now());
  const floorMs = (opts.floorSec ?? DEFAULT_AWAIT_FLOOR_SEC) * 1000; // human seconds -> engine ms (maestro convention)
  const start = clock();

  return new Promise<AwaitResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | null = null;
    let floorTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watcher) { try { watcher.close(); } catch { /* ignore */ } watcher = null; }
      if (floorTimer) { clearTimeout(floorTimer); floorTimer = null; }
      if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    };

    const finish = (r: AwaitResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };

    // Re-read + classify; resolve if terminal. Called on each wake event.
    const check = (): boolean => {
      if (!existsSync(opts.statusPath)) return false;
      const raw = readChild(opts.statusPath);
      const cls = classifyChildStatus(raw, opts.kind);
      if (cls?.terminal) {
        finish({ outcome: cls.outcome, terminal: true, hardSignal: cls.hardSignal, raw, elapsedMs: clock() - start });
        return true;
      }
      return false;
    };

    // 1. Immediate check (child may already be terminal).
    if (check()) return;

    // 2. Event-driven SUSPEND: wake only when the status dir/file changes.
    try {
      watcher = watch(dirname(opts.statusPath), { persistent: false }, () => { check(); });
    } catch { /* watch unavailable (e.g. dir missing) -> rely on floor + deadline */ }

    // 3. Coarse safety floor — fs.watch can coalesce/miss; re-check at a low frequency.
    const tick = () => {
      if (settled) return;
      if (check()) return;
      floorTimer = setTimeout(tick, floorMs);
    };
    floorTimer = setTimeout(tick, floorMs);

    // 4. Hard deadline -> timeout (a non-terminal child is a hard signal upstream).
    deadlineTimer = setTimeout(() => {
      const raw = existsSync(opts.statusPath) ? readChild(opts.statusPath) : null;
      finish({
        outcome: existsSync(opts.statusPath) ? 'timeout' : 'missing',
        terminal: false, hardSignal: true, raw, elapsedMs: clock() - start,
      });
    }, opts.timeoutMs);
  });
}
