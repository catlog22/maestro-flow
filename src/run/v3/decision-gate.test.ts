import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionStateV30Schema, type RunV30, type SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import { decideV3 } from './decide-v3.js';
import { V3StructuredError } from './errors.js';
import { completeRunAndAdvance, completeSessionV3, createRunningRunV3 } from './mutation-engine.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-v3-decision-gate-'));
  roots.push(value);
  mkdirSync(join(value, '.workflow'), { recursive: true });
  writeFileSync(join(value, '.workflow', 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }, null, 2)}\n`);
  return value;
}

/**
 * Two-step Session: step-1 completed and carrying the decision gate `gateId`
 * (must be resolved before step-2 may start / before completion), step-2
 * pending. `decisions` carries the gate's record with the given status.
 */
function gatedSession(overrides: {
  gateId?: string;
  decisionStatus?: 'open' | 'resolved' | 'escalated';
  missingDecision?: boolean;
  step1Status?: SessionStateV30['chain'][number]['status'];
  step2Status?: SessionStateV30['chain'][number]['status'];
} = {}): SessionStateV30 {
  const gateId = overrides.gateId ?? 'P-1';
  return {
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 decision gates', definition_of_done: 'tests pass',
    status: 'open', orchestration_revision: 0, activity_revision: 0,
    chain: [
      {
        step_id: 'step-1', command: 'implement', args: [], status: overrides.step1Status ?? 'completed',
        run_ids: [], goal_ref: null, decision_ref: gateId, decision_refs: [],
      },
      {
        step_id: 'step-2', command: 'verify', args: [], status: overrides.step2Status ?? 'pending',
        run_ids: [], goal_ref: null, decision_ref: null, decision_refs: [],
      },
    ],
    decisions: overrides.missingDecision ? [] : [{
      decision_id: gateId,
      after_step_id: 'step-1',
      status: overrides.decisionStatus ?? 'open',
      evidence_refs: [],
    }],
    active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
}

function setup(sessionInput: SessionStateV30): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30(sessionInput);
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  return store;
}

function pendingRun(runId: string, stepId: string): RunV30 {
  return {
    schema_version: 'run/3.0', run_id: runId, session_id: 's-1', step_id: stepId,
    parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'work', args: [], goal: null,
    status: 'pending', revision: 0, actor_id: 'actor-a', input_refs: [], output_refs: [],
    primary_artifact_id: null, verdict: null, summary: null,
    created_at: '2026-08-12T00:00:00.000Z', started_at: null, ended_at: null, sealed_at: null,
  };
}

function identity(requestId: string) {
  return {
    sessionId: 's-1', requestId, actorId: 'actor-a', reason: 'decision gate test',
    recordedAt: '2026-08-12T01:00:00.000Z',
  };
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('v3 decision gates', () => {
  it('blocks run next while the predecessor gate decision is open and releases it after decide proceed', () => {
    const store = setup(gatedSession({ step1Status: 'pending' }));

    // Real sealed predecessor (audit H1-①): complete step-1 so chain ordering
    // / publication authority exist before the gate test.
    expect(createRunningRunV3(store, {
      ...identity('req-seed-run1'), expectedOrchestrationRevision: 0,
      requestOperation: 'run-create',
      run: pendingRun('run-1', 'step-1'),
    }).status).toBe('applied');
    const completed = completeRunAndAdvance(store, {
      ...identity('req-seed-complete'), runId: 'run-1',
      expectedRunRevision: 1, expectedOrchestrationRevision: 1,
      summary: 'seed step-1', verdict: 'done',
    });
    expect(completed.status).toBe('applied');
    expect(completed.transition.result).toMatchObject({
      continuation: {
        operation: 'run-decide',
        locator: { session_id: 's-1', run_id: null },
        revision_requirements: { expected_orchestration_revision: 2, expected_run_revision: null },
        required_caller_fields: ['actor', 'verdict'],
      },
      next: { command: expect.stringContaining('maestro run decide P-1') },
    });

    // The gate check runs before the run-next publication machinery, so the
    // open gate surfaces before any publication error.
    expect(() => createRunningRunV3(store, {
      ...identity('req-next-blocked'), expectedOrchestrationRevision: 2,
      run: pendingRun('run-2', 'step-2'),
    })).toThrow(expect.objectContaining({
      code: 'INVALID_STATE_TRANSITION',
      next_actions: ['run-decide:P-1'],
      details: expect.objectContaining({
        reason: 'DECISION_GATE_BLOCKED', decision_id: 'P-1', decision_status: 'open',
      }),
    }));
    expect(store.readSessionV30('s-1')).toMatchObject({ orchestration_revision: 2, active_run_ids: [] });

    const decided = decideV3(store, {
      ...identity('req-decide'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      summary: 'gate approved', expectedOrchestrationRevision: 2, evidenceRefs: ['EVD-1'],
    });
    expect(decided.status).toBe('applied');
    expect(store.readSessionV30('s-1').decisions).toEqual([
      { decision_id: 'P-1', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-1'] },
    ]);

    const advanced = createRunningRunV3(store, {
      ...identity('req-next-pass'), expectedOrchestrationRevision: 3,
      requestOperation: 'run-create',
      run: pendingRun('run-2', 'step-2'),
    });
    expect(advanced.status).toBe('applied');
    expect(store.readSessionV30('s-1')).toMatchObject({
      orchestration_revision: 4, active_run_ids: ['run-2'],
      chain: [{ status: 'completed', run_ids: ['run-1'] }, { status: 'running', run_ids: ['run-2'] }],
    });
  });

  it('escalation keeps the Session open, stays blocking for run next, and a later proceed releases it', () => {
    const store = setup(gatedSession({ step1Status: 'pending' }));
    expect(createRunningRunV3(store, {
      ...identity('req-seed-run1'), expectedOrchestrationRevision: 0,
      requestOperation: 'run-create',
      run: pendingRun('run-1', 'step-1'),
    }).status).toBe('applied');
    const completed = completeRunAndAdvance(store, {
      ...identity('req-seed-complete'), runId: 'run-1',
      expectedRunRevision: 1, expectedOrchestrationRevision: 1,
      summary: 'seed step-1', verdict: 'done',
    });
    expect(completed.status).toBe('applied');
    expect(completed.transition.result).toMatchObject({
      continuation: { operation: 'run-decide' },
      next: { command: expect.stringContaining('maestro run decide P-1') },
    });

    const escalated = decideV3(store, {
      ...identity('req-escalate'), pointId: 'P-1', verdict: 'escalate', confidence: 'medium',
      summary: 'needs human review', expectedOrchestrationRevision: 2, evidenceRefs: ['EVD-x'],
    });
    expect(escalated.status).toBe('applied');
    expect(store.readSessionV30('s-1')).toMatchObject({
      // escalate no longer pauses the Session
      status: 'open',
      decisions: [{ decision_id: 'P-1', status: 'escalated' }],
    });

    let blocked: V3StructuredError | undefined;
    try {
      createRunningRunV3(store, {
        ...identity('req-next-escalated'), expectedOrchestrationRevision: 3,
        run: pendingRun('run-2', 'step-2'),
      });
    } catch (error) {
      blocked = error as V3StructuredError;
    }
    expect(blocked).toBeInstanceOf(V3StructuredError);
    expect(blocked!.next_actions).toEqual(['run-decide:P-1', 'review-escalated-decision:P-1']);
    expect(blocked!.details).toMatchObject({ decision_status: 'escalated' });

    const redecided = decideV3(store, {
      ...identity('req-redecide'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 3,
    });
    expect(redecided.status).toBe('applied');
    expect(store.readSessionV30('s-1').decisions[0].status).toBe('resolved');

    const advanced = createRunningRunV3(store, {
      ...identity('req-next-pass'), expectedOrchestrationRevision: 4,
      requestOperation: 'run-create',
      run: pendingRun('run-2', 'step-2'),
    });
    expect(advanced.status).toBe('applied');
  });

  it('declares a missing decision record as an open gate for run next', () => {
    const store = setup(gatedSession({ missingDecision: true }));
    expect(() => createRunningRunV3(store, {
      ...identity('req-next-missing'), expectedOrchestrationRevision: 0,
      run: pendingRun('run-2', 'step-2'),
    })).toThrow(expect.objectContaining({
      code: 'INVALID_STATE_TRANSITION',
      next_actions: ['run-decide:P-1'],
    }));
  });

  it('does not gate a skipped predecessor (skip carries its own evidence)', () => {
    const store = setup(gatedSession({ step1Status: 'skipped', decisionStatus: 'open' }));
    const advanced = createRunningRunV3(store, {
      ...identity('req-next-skipped'), expectedOrchestrationRevision: 0,
      requestOperation: 'run-create',
      run: pendingRun('run-2', 'step-2'),
    });
    expect(advanced.status).toBe('applied');
  });

  it('blocks session complete on an open gate, allows escalated with concerns, and passes resolved', () => {
    const completeArgs = {
      ...identity('req-complete'), expectedOrchestrationRevision: 0,
    };
    const completed = { step2Status: 'completed' as const };

    // open → blocked with an open_decision_gate blocker
    const openStore = setup(gatedSession({ decisionStatus: 'open', ...completed }));
    try {
      completeSessionV3(openStore, completeArgs);
      throw new Error('expected completion to be blocked');
    } catch (error) {
      expect(error).toBeInstanceOf(V3StructuredError);
      const structured = error as V3StructuredError;
      expect(structured.code).toBe('INVALID_STATE_TRANSITION');
      expect(structured.next_actions).toContain('resolve-open_decision_gate:P-1');
      expect(structured.details.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'open_decision_gate', id: 'P-1' }),
      ]));
    }

    // escalated → allowed, recorded in result.concerns
    const escalatedStore = setup(gatedSession({ decisionStatus: 'escalated', ...completed }));
    const escalated = completeSessionV3(escalatedStore, completeArgs);
    expect(escalated.status).toBe('applied');
    expect(escalated.transition.result).toMatchObject({
      status: 'completed',
      concerns: ['decision gate P-1 is escalated and remains open for review'],
    });

    // resolved → allowed without concerns
    const resolvedStore = setup(gatedSession({ decisionStatus: 'resolved', ...completed }));
    const resolved = completeSessionV3(resolvedStore, completeArgs);
    expect(resolved.status).toBe('applied');
    expect((resolved.transition.result as Record<string, unknown>).concerns).toBeUndefined();
  });

  it('parses legacy session/3.0 files without decision_ref via the default null', () => {
    const store = setup(gatedSession({ decisionStatus: 'resolved' }));
    const state = store.readSessionV30('s-1');
    // Strip the field, as a pre-gate session/3.0 file would be on disk.
    const legacy = structuredClone(state) as unknown as Record<string, unknown>;
    legacy.chain = (state.chain as Array<Record<string, unknown>>).map(({ decision_ref: _dropped, ...step }) => step);

    const parsed = sessionStateV30Schema.parse(legacy);
    expect(parsed.schema_version).toBe('session/3.0');
    for (const step of parsed.chain) {
      expect(step.decision_ref).toBeNull();
    }

    // The store read path applies the same default.
    writeFileSync(join(store.sessionDir('s-1'), 'session.json'), `${JSON.stringify(legacy, null, 2)}\n`);
    const reread = store.readSessionV30('s-1');
    expect(reread.chain.map(step => step.decision_ref)).toEqual([null, null]);
  });
});
