// M6 — session.json-first position / decomposition readers: orchestration.position
// / decomposition (session/1.1) win; ralph-meta is the fallback for un-migrated
// 1.0 sessions.

import { describe, expect, it } from 'vitest';
import { effectiveDecomposition, effectivePosition, type RalphMeta } from './session-adapter.js';
import type { SessionState } from '../run/schemas.js';

function session(orchestration: Partial<SessionState['orchestration']>): SessionState {
  return {
    schema_version: 'session/1.1',
    session_id: 's',
    intent: 'i',
    status: 'running',
    identity_revision: 0,
    activity_revision: 0,
    active_run_id: null,
    latest_completed_run_id: null,
    boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: '' },
    orchestration: {
      engine: 'ralph',
      quality_mode: 'standard',
      auto_mode: false,
      chain: [],
      decision_points: [],
      position: null,
      decomposition: null,
      lease: null,
      executor: null,
      ...orchestration,
    },
    requests: [],
    lifecycle: { sealed_at: null, seal_summary: null, promoted_spec_ids: [], promoted_knowhow_ids: [], forked_from: null },
    refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
  } as SessionState;
}

const meta: RalphMeta = {
  lifecycle_position: 'analyze',
  phase: 1,
  phase_is_new: true,
  milestone: 'M-meta',
  planning_mode: 'independent',
  scope_verdict: 'large',
  passed_gates: ['scope'],
  execution_criteria: ['meta crit'],
  task_decomposition: [{ id: 'GM', goal: 'meta goal', status: 'pending' }],
};

describe('effectivePosition', () => {
  it('reads orchestration.position when present (1.1)', () => {
    const s = session({
      position: {
        lifecycle: 'verify',
        phase: 3,
        phase_is_new: false,
        milestone: 'M-1.1',
        planning_mode: 'unified',
        passed_gates: ['scope', 'plan'],
        scope_verdict: 'medium',
      },
    });
    const pos = effectivePosition(s, meta);
    expect(pos.lifecycle_position).toBe('verify');
    expect(pos.phase).toBe(3);
    expect(pos.milestone).toBe('M-1.1');
    expect(pos.passed_gates).toEqual(['scope', 'plan']);
  });

  it('falls back to ralph-meta when no position block (1.0)', () => {
    const pos = effectivePosition(session({ position: null }), meta);
    expect(pos.lifecycle_position).toBe('analyze');
    expect(pos.phase).toBe(1);
    expect(pos.milestone).toBe('M-meta');
    expect(pos.scope_verdict).toBe('large');
  });
});

describe('effectiveDecomposition', () => {
  it('reads orchestration.decomposition when present (1.1)', () => {
    const s = session({
      decomposition: {
        execution_criteria: ['1.1 crit'],
        goals: [{ id: 'G1', goal: 'g', status: 'done' }],
        changelog: [],
      },
    });
    const dec = effectiveDecomposition(s, meta);
    expect(dec.execution_criteria).toEqual(['1.1 crit']);
    expect(dec.goals).toHaveLength(1);
    expect(dec.goals[0].id).toBe('G1');
  });

  it('falls back to ralph-meta arrays when no decomposition block (1.0)', () => {
    const dec = effectiveDecomposition(session({ decomposition: null }), meta);
    expect(dec.execution_criteria).toEqual(['meta crit']);
    expect(dec.goals[0].id).toBe('GM');
  });
});
