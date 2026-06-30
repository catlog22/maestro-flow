import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRouterSignals } from '../brain-derive.js';
import type { StateJsonV2 } from '../../utils/state-schema.js';

/**
 * Contract test for the _router.json latent-bug fix: every `ctx.project.<field>`
 * that _router.json reads as a router signal must be produced by
 * deriveRouterSignals (previously they were undefined -> router collapsed to
 * to_analyze). Guards against schema drift between the chain and the deriver.
 */
describe('_router.json contract', () => {
  const routerPath = join(process.cwd(), 'chains', '_router.json');
  const raw = readFileSync(routerPath, 'utf-8');
  const referenced = new Set<string>();
  for (const m of raw.matchAll(/ctx\.project\.([a-z_]+)/g)) referenced.add(m[1]);

  // Fields computed elsewhere (buildInitialContext spread / ctx.result), not part of this fix.
  const computedElsewhere = new Set([
    'initialized', 'accumulated_context', 'review_verdict', 'uat_status',
    'current_phase', 'phase_status', 'milestones', 'current_milestone',
  ]);

  const populated: StateJsonV2 = {
    version: '2.0', project_name: null, status: 'active',
    current_milestone: 'M1', current_task_id: null,
    milestones: [{ id: 'M1', name: 'M1', title: 'Core', status: 'active', phases: [1] }],
    artifacts: [
      { id: 'PLN-001', type: 'plan', milestone: 'M1', phase: 1, scope: 'phase', path: '', status: 'completed', depends_on: null, harvested: false, created_at: '2026-01-01T00:00:00Z', completed_at: null },
    ],
    accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
    transition_history: [], milestone_history: [], last_updated: '',
  };
  const sig = deriveRouterSignals(populated) as unknown as Record<string, unknown>;

  it('router references the four previously-uncomputed signals', () => {
    // sanity: the chain actually uses them (else the fix targets nothing)
    expect(referenced.has('milestones_total')).toBe(true);
    expect(referenced.has('latest_artifact_type')).toBe(true);
  });

  it('every router-signal field is now produced (non-undefined) by deriveRouterSignals', () => {
    for (const field of referenced) {
      if (computedElsewhere.has(field)) continue;
      expect(sig, `field ${field} read by _router.json must be produced`).toHaveProperty(field);
      expect(sig[field], `field ${field} must not be undefined`).not.toBeUndefined();
    }
  });

  it('on a populated registry the signals are meaningful (not the degenerate cold-state)', () => {
    expect(sig.milestones_total).toBe(1);
    expect(sig.latest_artifact_type).toBe('plan');
    expect(sig.has_pending_plans).toBe(true);   // plan with no completed execute
  });
});
