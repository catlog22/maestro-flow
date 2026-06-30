import { describe, it, expect } from 'vitest';
import { evaluateStopPredicate, type MilestoneView } from '../stop-predicate.js';
import type { Blocker } from '../brain-schema.js';

const M = (id: string, status: MilestoneView['status'], mandatory = true, defer_reason?: string): MilestoneView =>
  ({ id, mandatory, status, defer_reason });

const infoBlocker: Blocker = { id: 'BLK-1', severity: 'info', state: 'acknowledged', note: 'skill-only' };
const openDefect: Blocker = { id: 'BLK-2', severity: 'defect', state: 'open', note: 'bug' };

describe('evaluateStopPredicate', () => {
  it('all mandatory completed -> satisfied, status completed', () => {
    const r = evaluateStopPredicate([M('M1', 'completed'), M('M2', 'completed')], []);
    expect(r.satisfied).toBe(true);
    expect(r.terminalStatus).toBe('completed');
  });

  it('mandatory incomplete -> NOT satisfied (not-too-early)', () => {
    const r = evaluateStopPredicate([M('M1', 'completed'), M('M2', 'pending')], []);
    expect(r.satisfied).toBe(false);
  });

  it('optional acknowledged-deferred counts as resolved -> satisfied, completed-with-optional-deferred (R12)', () => {
    const r = evaluateStopPredicate(
      [M('M1', 'completed'), M('M3', 'deferred', false, 'no API key in env')],
      [],
    );
    expect(r.satisfied).toBe(true);
    expect(r.terminalStatus).toBe('completed-with-optional-deferred');
  });

  it('optional deferred WITHOUT reason -> NOT resolved (not-never on a real gap)', () => {
    const r = evaluateStopPredicate(
      [M('M1', 'completed'), M('M3', 'deferred', false, '')],
      [],
    );
    expect(r.satisfied).toBe(false);
  });

  it('optional still pending -> NOT satisfied', () => {
    const r = evaluateStopPredicate([M('M1', 'completed'), M('M3', 'pending', false)], []);
    expect(r.satisfied).toBe(false);
  });

  it('open DEFECT blocker blocks termination', () => {
    const r = evaluateStopPredicate([M('M1', 'completed')], [openDefect]);
    expect(r.satisfied).toBe(false);
    expect(r.predicate.no_open_defect_blocker).toBe(false);
  });

  it('INFO blocker does NOT block termination (R5 deadlock fix)', () => {
    const r = evaluateStopPredicate([M('M1', 'completed')], [infoBlocker]);
    expect(r.satisfied).toBe(true);
  });

  it('mandatory deferred blocks termination (cannot silently drop required work)', () => {
    const r = evaluateStopPredicate([M('M1', 'deferred', true, 'gave up')], []);
    expect(r.satisfied).toBe(false);
    expect(r.predicate.no_open_mandatory_deferred).toBe(false);
  });
});
