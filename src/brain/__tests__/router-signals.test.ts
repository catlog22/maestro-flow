import { describe, it, expect } from 'vitest';
import { deriveRouterSignals } from '../brain-derive.js';
import { deriveCursor } from '../brain-derive.js';
import type { ArtifactEntry, StateJsonV2 } from '../../utils/state-schema.js';

const art = (over: Partial<ArtifactEntry>): ArtifactEntry => ({
  id: 'ANL-001', type: 'analyze', milestone: 'M1', phase: 1, scope: 'phase', path: '',
  status: 'completed', depends_on: null, harvested: false, created_at: '2026-01-01T00:00:00Z',
  completed_at: null, ...over,
});

const baseState = (over: Partial<StateJsonV2> = {}): StateJsonV2 => ({
  version: '2.0', project_name: null, status: 'active',
  current_milestone: 'M1', current_task_id: null,
  milestones: [{ id: 'M1', name: 'M1', title: 'Core', status: 'active', phases: [1, 2] }],
  artifacts: [], accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
  transition_history: [], milestone_history: [], last_updated: '', ...over,
});

describe('deriveRouterSignals (fixes _router.json latent bug)', () => {
  it('cold/empty state -> all signals defined (not undefined), milestones_total counts', () => {
    const s = baseState({ artifacts: [] });
    const sig = deriveRouterSignals(s);
    expect(sig.milestones_total).toBe(1);
    expect(sig.latest_artifact_type).toBeNull();
    expect(sig.has_pending_plans).toBe(false);
    expect(sig.all_phases_executed).toBe(false);
  });

  it('latest_artifact_type = most recent by created_at', () => {
    const s = baseState({
      artifacts: [
        art({ id: 'ANL-001', type: 'analyze', created_at: '2026-01-01T00:00:00Z' }),
        art({ id: 'PLN-001', type: 'plan', created_at: '2026-01-02T00:00:00Z' }),
      ],
    });
    expect(deriveRouterSignals(s).latest_artifact_type).toBe('plan');
  });

  it('has_pending_plans true when a plan has no completed execute for its phase', () => {
    const s = baseState({ artifacts: [art({ id: 'PLN-001', type: 'plan', phase: 1, status: 'completed' })] });
    expect(deriveRouterSignals(s).has_pending_plans).toBe(true);
  });

  it('has_pending_plans false once the phase is executed', () => {
    const s = baseState({
      artifacts: [
        art({ id: 'PLN-001', type: 'plan', phase: 1 }),
        art({ id: 'EXC-001', type: 'execute', phase: 1, status: 'completed' }),
      ],
    });
    expect(deriveRouterSignals(s).has_pending_plans).toBe(false);
  });

  it('all_phases_executed true only when every phase has a completed execute', () => {
    const partial = baseState({ artifacts: [art({ id: 'EXC-001', type: 'execute', phase: 1, status: 'completed' })] });
    expect(deriveRouterSignals(partial).all_phases_executed).toBe(false); // phase 2 not executed
    const full = baseState({
      artifacts: [
        art({ id: 'EXC-001', type: 'execute', phase: 1, status: 'completed' }),
        art({ id: 'EXC-002', type: 'execute', phase: 2, status: 'completed' }),
      ],
    });
    expect(deriveRouterSignals(full).all_phases_executed).toBe(true);
  });
});

describe('deriveCursor', () => {
  it('points to next-incomplete phase of current milestone', () => {
    const s = baseState({ artifacts: [art({ id: 'EXC-001', type: 'execute', phase: 1, status: 'completed' })] });
    expect(deriveCursor(s)).toBe('M1/phase-2');
  });

  it('skips completed milestones and resolved optional ones', () => {
    const s = baseState({
      current_milestone: 'M2',
      milestones: [
        { id: 'M1', name: 'M1', title: '', status: 'completed', phases: [1] },
        { id: 'M2', name: 'M2', title: '', status: 'active', phases: [] } as never,
        // optional deferred-with-reason should be skipped
        ({ id: 'M3', name: 'M3', title: '', status: 'deferred', phases: [], mandatory: false, defer_reason: 'opt' } as never),
      ],
    });
    expect(deriveCursor(s)).toBe('M2');
  });

  it('returns null when everything resolved', () => {
    const s = baseState({
      current_milestone: 'M1',
      milestones: [{ id: 'M1', name: 'M1', title: '', status: 'completed', phases: [1] }],
    });
    expect(deriveCursor(s)).toBeNull();
  });
});
