import { describe, it, expect } from 'vitest';
import { decide, applyBump, resetUnit, bumpCrashRetry, type DecideContext } from '../brain-decide.js';
import { newConvergence, REVISES_CAP, STUCK_CAP, CRASH_RETRIES_CAP } from '../brain-schema.js';
import type { StopEvaluation } from '../stop-predicate.js';

const notDone: StopEvaluation = {
  predicate: { mandatory_all_completed: false, optional_all_resolved: false, no_open_defect_blocker: true, no_open_mandatory_deferred: true },
  satisfied: false,
  terminalStatus: 'completed',
};
const done: StopEvaluation = { ...notDone, satisfied: true };

const base = (over: Partial<DecideContext> = {}): DecideContext => ({
  stop: notDone,
  round: 1,
  maxRounds: 30,
  autonomous: true,
  cursorUnit: 'M1/phase-1',
  signal: { kind: 'ok' },
  convergence: newConvergence(),
  ...over,
});

describe('decide — priority order', () => {
  it('terminate first when stop satisfied (even with a pending signal)', () => {
    const r = decide(base({ stop: done, signal: { kind: 'result-problem' } }));
    expect(r.decision).toBe('terminate');
    expect(r.terminalStatus).toBe('completed');
  });

  it('budget exhausted -> terminate partial', () => {
    const r = decide(base({ round: 30, maxRounds: 30 }));
    expect(r.decision).toBe('terminate');
    expect(r.terminalStatus).toBe('partial');
  });

  it('default advance when signal ok', () => {
    expect(decide(base()).decision).toBe('advance');
  });

  it('roadmap-problem -> revise (under cap)', () => {
    const r = decide(base({ signal: { kind: 'roadmap-problem', issue: 'X' } }));
    expect(r.decision).toBe('revise-roadmap');
    expect(r.bump).toEqual({ counter: 'revises', key: 'X' });
  });

  it('result-problem -> insert-fix (under cap), bumps stuck', () => {
    const r = decide(base({ signal: { kind: 'result-problem' } }));
    expect(r.decision).toBe('insert-fix');
    expect(r.bump).toEqual({ counter: 'stuck', key: 'M1/phase-1' });
  });
});

describe('decide — convergence caps', () => {
  it('revises at cap -> DEMOTE to result-problem (N2 anti-starvation)', () => {
    const conv = newConvergence();
    conv.revises['X'] = REVISES_CAP;
    const r = decide(base({ signal: { kind: 'roadmap-problem', issue: 'X' }, convergence: conv }));
    expect(r.decision).toBe('insert-fix');   // demoted to fixing the unit
    expect(r.demote).toBe(true);
  });

  it('stuck at cap (auto) -> give up: advance past + defer', () => {
    const conv = newConvergence();
    conv.stuck['M1/phase-1'] = STUCK_CAP;
    const r = decide(base({ signal: { kind: 'result-problem' }, convergence: conv }));
    expect(r.decision).toBe('advance');
    expect(r.giveUp).toBe(true);
  });

  it('stuck at cap (non-auto) -> escalate', () => {
    const conv = newConvergence();
    conv.stuck['M1/phase-1'] = STUCK_CAP;
    const r = decide(base({ autonomous: false, signal: { kind: 'result-problem' }, convergence: conv }));
    expect(r.escalate).toBe(true);
  });

  it('unfixable-external -> immediate defer fast-path (R6-O1), no need to reach cap', () => {
    const r = decide(base({ signal: { kind: 'unfixable-external' } }));
    expect(r.decision).toBe('advance');
    expect(r.giveUp).toBe(true);
  });
});

describe('convergence mutators', () => {
  it('applyBump increments', () => {
    const c = newConvergence();
    applyBump(c, { counter: 'stuck', key: 'U' });
    applyBump(c, { counter: 'stuck', key: 'U' });
    expect(c.stuck['U']).toBe(2);
  });
  it('resetUnit clears stuck + crash_retries on advance to new unit', () => {
    const c = newConvergence();
    c.stuck['U'] = 2; c.crash_retries['U'] = 1;
    resetUnit(c, 'U');
    expect(c.stuck['U']).toBeUndefined();
    expect(c.crash_retries['U']).toBeUndefined();
  });
  it('bumpCrashRetry returns the new count', () => {
    const c = newConvergence();
    expect(bumpCrashRetry(c, 'U')).toBe(1);
    expect(bumpCrashRetry(c, 'U')).toBe(2);
    expect(bumpCrashRetry(c, 'U')).toBe(CRASH_RETRIES_CAP + 1);
  });
});
