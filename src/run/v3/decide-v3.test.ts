import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runResponseV12Schema } from '../protocol-schemas.js';
import type { SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import { registerRunV3Command } from '../../commands/run-v3.js';
import { decideV3, type DecideV3Input } from './decide-v3.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-v3-decide-'));
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

function session(status: SessionStateV30['status'] = 'open'): SessionStateV30 {
  return {
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 decide', definition_of_done: 'tests pass',
    status, orchestration_revision: 0, activity_revision: 0,
    chain: [
      { step_id: 'step-1', command: 'implement', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] },
      { step_id: 'step-2', command: 'verify', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] },
    ],
    decisions: [], active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
}

function setup(status: SessionStateV30['status'] = 'open'): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30(session(status));
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  return store;
}

function identity(requestId: string): Omit<DecideV3Input, 'pointId' | 'verdict' | 'confidence' | 'expectedOrchestrationRevision'> {
  return {
    sessionId: 's-1', requestId, actorId: 'actor-a', reason: 'test decide',
    recordedAt: '2026-08-12T01:00:00.000Z',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('v3 run decide mutation', () => {
  it('upserts open decisions, merges evidence, and links the chain step decision_refs', () => {
    const store = setup();
    const applied = decideV3(store, {
      ...identity('req-proceed'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      summary: 'proceed with implementation', expectedOrchestrationRevision: 0, evidenceRefs: ['EVD-1'],
    });
    expect(applied).toMatchObject({
      status: 'applied',
      transition: {
        target_type: 'orchestration', target_id: 's-1', revision_before: 0, revision_after: 1,
        result: {
          point_id: 'P-1', status: 'resolved', orchestration_revision: 1,
          next: {
            suggest_only: true,
            command: 'maestro run next --session s-1 --actor <actor-id> --expected-orchestration-revision 1 --json',
          },
          continuation: {
            operation: 'next', locator: { session_id: 's-1', run_id: null },
            revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
          },
        },
      },
    });
    expect(store.readSessionV30('s-1')).toMatchObject({
      status: 'open', orchestration_revision: 1, activity_revision: 1,
      decisions: [{ decision_id: 'P-1', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-1'] }],
      chain: [{ decision_refs: ['P-1'] }, { decision_refs: [] }],
    });

    const fix = decideV3(store, {
      ...identity('req-fix'), pointId: 'P-2', verdict: 'fix', confidence: 'medium',
      expectedOrchestrationRevision: 1, evidenceRefs: ['EVD-2'],
    });
    expect(fix.status).toBe('applied');
    expect(store.readSessionV30('s-1').decisions).toEqual([
      { decision_id: 'P-1', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-1'] },
      { decision_id: 'P-2', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-2'] },
    ]);

    const redecide = decideV3(store, {
      ...identity('req-redecide'), pointId: 'P-1', verdict: 'fix', confidence: 'low',
      expectedOrchestrationRevision: 2, evidenceRefs: ['EVD-3'],
    });
    expect(redecide.status).toBe('applied');
    const after = store.readSessionV30('s-1');
    expect(after.decisions).toEqual([
      { decision_id: 'P-1', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-1', 'EVD-3'] },
      { decision_id: 'P-2', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-2'] },
    ]);
    expect(after.chain[0].decision_refs).toEqual(['P-1', 'P-2']);
    expect(after.chain[1].decision_refs).toEqual([]);
  });

  it('escalates a decision while keeping the Session open and allowing re-decide', () => {
    const store = setup();
    const applied = decideV3(store, {
      ...identity('req-escalate'), pointId: 'P-1', verdict: 'escalate', confidence: 'medium',
      summary: 'needs human review', expectedOrchestrationRevision: 0, evidenceRefs: ['EVD-x'],
    });
    expect(applied).toMatchObject({
      status: 'applied',
      transition: {
        target_type: 'orchestration', revision_before: 0, revision_after: 1,
        result: {
          point_id: 'P-1', status: 'escalated', orchestration_revision: 1,
          next: {
            suggest_only: true,
            command: 'maestro run decide P-1 --session s-1 --actor <actor-id> --expected-orchestration-revision 1 --verdict <verdict> --json',
          },
          continuation: {
            operation: 'run-decide', locator: { session_id: 's-1', run_id: null },
            revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
            required_caller_fields: ['actor', 'verdict'],
          },
        },
      },
    });
    expect(store.readSessionV30('s-1')).toMatchObject({
      // escalate no longer pauses the Session; the run next gate check blocks
      // advancement while the decision stays escalated.
      status: 'open', orchestration_revision: 1, activity_revision: 1,
      decisions: [{ decision_id: 'P-1', after_step_id: 'step-1', status: 'escalated', evidence_refs: ['EVD-x'] }],
      chain: [{ decision_refs: ['P-1'] }, { decision_refs: [] }],
    });
    // The Session stays open, so further decisions remain allowed.
    const followUp = decideV3(store, {
      ...identity('req-follow-up'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 1, evidenceRefs: ['EVD-y'],
    });
    expect(followUp.status).toBe('applied');
    expect(store.readSessionV30('s-1')).toMatchObject({
      status: 'open', orchestration_revision: 2,
      decisions: [{ decision_id: 'P-1', status: 'resolved', evidence_refs: ['EVD-x', 'EVD-y'] }],
    });
  });

  it('routes a resolved terminal chain to Session completion', () => {
    const store = setup();
    const current = store.readSessionV30('s-1');
    store.writeSessionV30({
      ...current,
      chain: current.chain.map((step, index) => ({
        ...step,
        status: 'completed',
        decision_ref: index === 1 ? 'P-terminal' : null,
      })),
      decisions: [{
        decision_id: 'P-terminal', after_step_id: 'step-2', status: 'open', evidence_refs: [],
      }],
    });

    const applied = decideV3(store, {
      ...identity('req-terminal'), pointId: 'P-terminal', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 0,
    });
    expect(applied.transition.result).toMatchObject({
      status: 'resolved',
      next: {
        command: 'maestro session complete --session s-1 --actor <actor-id> --expected-orchestration-revision 1 --json',
      },
      continuation: {
        operation: 'session-complete',
        revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
      },
    });
  });

  it('replays the same requestId without re-applying', () => {
    const store = setup();
    const input: DecideV3Input = {
      ...identity('req-replay'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 0, evidenceRefs: ['EVD-1'],
    };
    const applied = decideV3(store, input);
    const replayed = decideV3(store, input);
    expect(replayed).toEqual({ status: 'replayed', transition: applied.transition });
    expect(store.readSessionV30('s-1')).toMatchObject({
      status: 'open', orchestration_revision: 1, activity_revision: 1,
      decisions: [{ decision_id: 'P-1', status: 'resolved' }],
    });
  });

  it('rejects a stale expected orchestration revision with ORCHESTRATION_REVISION_CONFLICT', () => {
    const store = setup();
    const before = store.readSessionV30('s-1');
    expect(() => decideV3(store, {
      ...identity('req-conflict'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 5,
    })).toThrow(expect.objectContaining({
      code: 'ORCHESTRATION_REVISION_CONFLICT', expected_revision: 5, current_revision: 0,
    }));
    expect(store.readSessionV30('s-1')).toEqual(before);
    expect(store.readRequestReceiptV20('s-1', 'req-conflict')).toBeNull();
  });

  it.each(['completed', 'archived'] as const)('rejects decide while the Session is %s', status => {
    const store = setup(status);
    expect(() => decideV3(store, {
      ...identity(`req-${status}`), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 0,
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(store.readSessionV30('s-1')).toMatchObject({
      status, orchestration_revision: 0, activity_revision: 0, decisions: [],
    });
  });

  it('rejects invalid verdicts and confidences with INVALID_ARGUMENT', () => {
    const store = setup();
    expect(() => decideV3(store, {
      ...identity('req-bad-verdict'), pointId: 'P-1', verdict: 'maybe' as never, confidence: 'high',
      expectedOrchestrationRevision: 0,
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => decideV3(store, {
      ...identity('req-bad-confidence'), pointId: 'P-1', verdict: 'proceed', confidence: 'certain' as never,
      expectedOrchestrationRevision: 0,
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(store.readSessionV30('s-1')).toMatchObject({ decisions: [], orchestration_revision: 0 });
    expect(store.readRequestReceiptV20('s-1', 'req-bad-verdict')).toBeNull();
    expect(store.readRequestReceiptV20('s-1', 'req-bad-confidence')).toBeNull();
  });

  it('honors an explicit --after-step and falls back to the first pending step', () => {
    const store = setup();
    const explicit = decideV3(store, {
      ...identity('req-after-step'), pointId: 'P-1', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 0, afterStepId: 'step-2',
    });
    expect(explicit.status).toBe('applied');
    expect(store.readSessionV30('s-1')).toMatchObject({
      decisions: [{ decision_id: 'P-1', after_step_id: 'step-2', status: 'resolved' }],
      chain: [{ decision_refs: [] }, { decision_refs: ['P-1'] }],
    });

    const noPending = setup();
    const current = noPending.readSessionV30('s-1');
    noPending.writeSessionV30({
      ...current,
      chain: current.chain.map(step => ({ ...step, status: 'running' })),
    });
    const implicit = decideV3(noPending, {
      ...identity('req-no-pending'), pointId: 'P-2', verdict: 'fix', confidence: 'low',
      expectedOrchestrationRevision: 0,
    });
    expect(implicit.status).toBe('applied');
    expect(noPending.readSessionV30('s-1').decisions[0]).toMatchObject({
      decision_id: 'P-2', after_step_id: null, status: 'resolved', evidence_refs: [],
    });
    expect(() => decideV3(noPending, {
      ...identity('req-unknown-step'), pointId: 'P-3', verdict: 'proceed', confidence: 'high',
      expectedOrchestrationRevision: 1, afterStepId: 'step-unknown',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('maestro run decide run-response/1.2 envelope', () => {
  async function invoke(args: string[]) {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const program = new Command().name('maestro').exitOverride();
    registerRunV3Command(program);
    await program.parseAsync(['node', 'maestro', ...args]);
    expect(writes).toHaveLength(1);
    return runResponseV12Schema.parse(JSON.parse(writes[0]));
  }

  it('emits a run-decide success envelope with orchestration revision', async () => {
    const store = setup();
    const response = await invoke([
      'run', 'decide', 'P-1', '--verdict', 'proceed', '--confidence', 'high', '--summary', 'approved',
      '--session', 's-1', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-cli-decide', '--expected-orchestration-revision', '0',
      '--reason', 'cli decide test', '--evidence', 'EVD-cli', '--json', '--workflow-root', store.projectRoot,
    ]);
    expect(response).toMatchObject({
      schema_version: 'run-response/1.2', operation: 'run-decide', ok: true, exit_code: 0,
      locator: { session_id: 's-1', run_id: null },
      replay: { status: 'applied' },
      revision: { target_type: 'orchestration', target_id: 's-1', revision: 1 },
      result: { point_id: 'P-1', status: 'resolved', orchestration_revision: 1 },
    });
    expect(store.readSessionV30('s-1').decisions).toEqual([
      { decision_id: 'P-1', after_step_id: 'step-1', status: 'resolved', evidence_refs: ['EVD-cli'] },
    ]);
  });

  it('emits a run-decide error envelope for an invalid verdict', async () => {
    const store = setup();
    const response = await invoke([
      'run', 'decide', 'P-1', '--verdict', 'maybe',
      '--session', 's-1', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-cli-bad', '--expected-orchestration-revision', '0',
      '--reason', 'bad verdict', '--json', '--workflow-root', store.projectRoot,
    ]);
    expect(response).toMatchObject({ operation: 'run-decide', ok: false });
    expect(response.error?.message).toContain('--verdict must be proceed');
    expect(store.readSessionV30('s-1')).toMatchObject({ decisions: [], orchestration_revision: 0 });
  });
});
