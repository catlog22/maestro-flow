import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectArtifactCompatibility } from '../artifact-compatibility.js';
import type { RunV30, SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import { V3StructuredError } from './errors.js';
import {
  completeRunAndAdvance,
  completeSessionV3,
  createRunV3,
  createRunningRunV3,
  mutateRunV3,
  recoverSealRunV3,
  republishArtifactV3,
} from './mutation-engine.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-v3-mutation-'));
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
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 mutation', definition_of_done: 'tests pass',
    status, orchestration_revision: 0, activity_revision: 0,
    chain: [
      { step_id: 'step-1', command: 'implement', args: [], status: 'running', run_ids: ['r-1'], goal_ref: null, decision_refs: [] },
      { step_id: 'step-2', command: 'verify', args: [], status: 'pending', run_ids: ['r-2'], goal_ref: null, decision_refs: [] },
    ],
    decisions: [], active_run_ids: ['r-1', 'r-2'], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
}

function run(runId: string, stepId: string, status: RunV30['status'] = 'running'): RunV30 {
  return {
    schema_version: 'run/3.0', run_id: runId, session_id: 's-1', step_id: stepId,
    parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'work', args: [], goal: null,
    status, revision: 0, actor_id: 'actor-a', input_refs: [], output_refs: [],
    primary_artifact_id: null, verdict: null, summary: null, legacy_execution_generation: null,
    created_at: '2026-08-12T00:00:00.000Z', started_at: status === 'running' ? '2026-08-12T00:00:00.000Z' : null,
    ended_at: null, sealed_at: null,
  };
}

function setup(status: SessionStateV30['status'] = 'open'): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30(session(status));
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  store.writeRunV30(run('r-1', 'step-1'));
  store.writeRunV30(run('r-2', 'step-2'));
  return store;
}

function configureRequiredOutput(store: SessionStore, produce = true): void {
  const commandDir = join(store.projectRoot, '.claude', 'commands');
  mkdirSync(commandDir, { recursive: true });
  writeFileSync(join(commandDir, 'work.md'), `<contract>\ncontract_version: 2\nconsumes: []\nproduces:\n  - kind: result\n    path: outputs/result.json\n    alias: current-result\n    role: primary\n    required: true\n    schema: result/1.0\ngates:\n  entry: []\n  exit: []\n</contract>\n`);
  if (!produce) return;
  const outputs = join(store.runDir('s-1', 'r-1'), 'outputs');
  mkdirSync(outputs, { recursive: true });
  writeFileSync(join(outputs, 'result.json'), `${JSON.stringify({
    _meta: { kind: 'result', schema: 'result/1.0', role: 'primary', alias: 'current-result' },
    ok: true,
  }, null, 2)}\n`);
}

function identity(requestId: string) {
  return {
    sessionId: 's-1', requestId, actorId: 'actor-a', reason: 'test mutation',
    recordedAt: '2026-08-12T01:00:00.000Z',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('v3 mutation engine', () => {
  it('republishes compatibility authority without allocating the pending consumer Run', () => {
    const store = setup();
    const commandDir = join(store.projectRoot, '.claude', 'commands');
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(join(commandDir, 'producer.md'), `<contract>\ncontract_version: 2.1\narguments: []\nconsumes: []\nproduces:\n  - kind: execution\n    path: outputs/execution.json\n    alias: latest-execution\n    role: attachment\n    required: true\n    schema: execution/1.0\ngates:\n  entry: []\n  exit: []\n</contract>\n`);
    writeFileSync(join(commandDir, 'review.md'), `<contract>\ncontract_version: 2.1\narguments: []\nconsumes:\n  - kind: execution\n    alias: latest-execution\n    required: true\n    require_status: sealed\n    schema: execution/1.0\n    role: primary\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n`);
    const sourceDir = join(store.runDir('s-1', 'r-1'), 'outputs');
    mkdirSync(sourceDir, { recursive: true });
    const sourceBytes = `${JSON.stringify({
      _meta: { kind: 'execution', schema: 'execution/1.0', role: 'attachment', alias: 'latest-execution' },
      changes: [],
    }, null, 2)}\n`;
    writeFileSync(join(sourceDir, 'execution.json'), sourceBytes);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    store.writeRunV30({
      ...store.readRunV30('s-1', 'r-1'), command: 'producer', status: 'sealed', revision: 2,
      output_refs: ['ART-source'], sealed_at: '2026-08-12T00:30:00.000Z',
      ended_at: '2026-08-12T00:30:00.000Z', verdict: 'done', summary: 'source',
    });
    const state = store.readSessionV30('s-1');
    store.writeSessionV30({
      ...state, active_run_ids: [], orchestration_revision: 4, activity_revision: 4,
      chain: [
        { ...state.chain[0], command: 'producer', status: 'completed', run_ids: ['r-1'] },
        { ...state.chain[1], command: 'review', status: 'pending', run_ids: [] },
      ],
    });
    writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 1,
      artifacts: {
        'ART-source': {
          kind: 'execution', role: 'attachment', producer_run_id: 'r-1',
          relative_path: 'runs/r-1/outputs/execution.json', media_type: 'application/json',
          schema_version: 'execution/1.0', content_hash: sourceHash, size: Buffer.byteLength(sourceBytes),
          status: 'sealed', derived_from: [], replaces: null,
        },
      },
      aliases: { 'latest-execution': 'ART-source' },
    }, null, 2)}\n`);
    const assessment = inspectArtifactCompatibility(store.projectRoot, {
      sessionId: 's-1', artifactId: 'ART-source', consumerCommand: 'review', alias: 'latest-execution',
    });
    expect(assessment.classification).toBe('semantic_republish_required');
    const applied = republishArtifactV3(store, {
      ...identity('req-artifact-v3'), artifactId: 'ART-source', consumerCommand: 'review',
      alias: 'latest-execution', assessmentHash: assessment.assessment_hash,
      expectedArtifactRevision: 1, expectedSessionRevision: 4, evidenceRefs: ['EVD-v3'],
    });
    expect(applied).toMatchObject({
      status: 'applied', transition: {
        target_type: 'artifact', revision_before: 1, revision_after: 2,
        result: { operation: 'artifact-republish', receipt: { schema_version: 'artifact-republish/1.0' } },
      },
    });
    const result = applied.transition.result as { artifact_id: string; compatibility_run_id: string };
    const after = store.readSessionV30('s-1');
    expect(after).toMatchObject({
      orchestration_revision: 5, activity_revision: 5, active_run_ids: [],
      chain: [
        { command: 'producer', status: 'completed' },
        { command: 'artifact-compatibility-republish', status: 'completed' },
        { command: 'review', status: 'pending', run_ids: [] },
      ],
    });
    expect(store.readRunV30('s-1', result.compatibility_run_id)).toMatchObject({ status: 'sealed' });
    const registry = JSON.parse(readFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), 'utf8'));
    expect(registry.artifacts['ART-source']).toMatchObject({ role: 'attachment', status: 'sealed' });
    expect(registry.artifacts[result.artifact_id]).toMatchObject({ role: 'primary', derived_from: ['ART-source'] });
    expect(registry.aliases['latest-execution']).toBe(result.artifact_id);
    expect(readFileSync(join(sourceDir, 'execution.json'), 'utf8')).toBe(sourceBytes);
    expect(republishArtifactV3(store, {
      ...identity('req-artifact-v3'), artifactId: 'ART-source', consumerCommand: 'review',
      alias: 'latest-execution', assessmentHash: assessment.assessment_hash,
      expectedArtifactRevision: 1, expectedSessionRevision: 4, evidenceRefs: ['EVD-v3'],
    })).toEqual({ status: 'replayed', transition: applied.transition });
    const next = createRunningRunV3(store, {
      ...identity('req-review-next'), expectedOrchestrationRevision: 5,
      run: { ...run('r-3', 'step-2', 'pending'), command: 'review' },
    });
    expect(next.status).toBe('applied');
    expect(next.transition.result).toMatchObject({
      task: { command: 'review', input_refs: [result.artifact_id] },
    });
    expect(store.readRunV30('s-1', 'r-3')).toMatchObject({
      status: 'running', input_refs: [result.artifact_id],
    });
  });

  it('mutates different Runs without CAS interference and blindly increments activity', async () => {
    const store = setup();
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => mutateRunV3(store, {
        ...identity('req-r1'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked',
      })),
      Promise.resolve().then(() => mutateRunV3(store, {
        ...identity('req-r2'), actorId: 'actor-b', runId: 'r-2', expectedRunRevision: 0, toStatus: 'blocked',
      })),
    ]);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(store.readRunV30('s-1', 'r-1').revision).toBe(1);
    expect(store.readRunV30('s-1', 'r-2').revision).toBe(1);
    expect(store.readSessionV30('s-1').activity_revision).toBe(2);
  });

  it('allows only one same-Run mutation for the same expected revision', async () => {
    const store = setup();
    const results = await Promise.allSettled([
      Promise.resolve().then(() => mutateRunV3(store, {
        ...identity('req-a'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked',
      })),
      Promise.resolve().then(() => mutateRunV3(store, {
        ...identity('req-b'), actorId: 'actor-b', runId: 'r-1', expectedRunRevision: 0,
        expectedOrchestrationRevision: 0, toStatus: 'cancelled',
      })),
    ]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(V3StructuredError);
    expect((rejected.reason as V3StructuredError).toJSON()).toMatchObject({
      code: 'RUN_REVISION_CONFLICT', expected_revision: 0, current_revision: 1,
    });
    expect(store.readSessionV30('s-1').activity_revision).toBe(1);
  });

  it('replays the original receipt without another activity increment', () => {
    const store = setup();
    const input = { ...identity('req-replay'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked' as const };
    const applied = mutateRunV3(store, input);
    const replayed = mutateRunV3(store, input);
    expect(replayed).toEqual({ status: 'replayed', transition: applied.transition });
    expect(store.readSessionV30('s-1').activity_revision).toBe(1);
  });

  it('treats changed audit inputs as request conflicts', () => {
    const store = setup();
    const input = { ...identity('req-audit'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked' as const };
    mutateRunV3(store, input);
    for (const changed of [
      { ...input, actorId: 'actor-b' },
      { ...input, reason: 'different reason' },
      { ...input, evidenceRefs: ['evidence-2'] },
    ]) {
      expect(() => mutateRunV3(store, changed))
        .toThrow(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
    }
    expect(store.readSessionV30('s-1').activity_revision).toBe(1);
  });

  it('rejects the same request across actors and leaves state unchanged', () => {
    const store = setup();
    const base = { ...identity('req-conflict'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked' as const };
    mutateRunV3(store, base);
    expect(() => mutateRunV3(store, { ...base, actorId: 'actor-b' }))
      .toThrow(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
    expect(store.readSessionV30('s-1').activity_revision).toBe(1);
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'pending'],
  ] as const)('projects a running Run transitioned to %s into recoverable chain state %s', (runStatus, stepStatus) => {
    const store = setup();
    const result = mutateRunV3(store, {
      ...identity(`req-${runStatus}`), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, toStatus: runStatus,
      verdict: runStatus === 'failed' ? 'needs_retry' : undefined,
    });
    expect(result.transition).toMatchObject({ revision_before: 0, revision_after: 1 });
    expect(result.transition.result).toMatchObject({
      continuation: { operation: runStatus === 'cancelled' ? 'next' : 'check' },
    });
    expect(store.readRunV30('s-1', 'r-1')).toMatchObject({ status: runStatus, revision: 1 });
    expect(store.readSessionV30('s-1')).toMatchObject({
      orchestration_revision: 1, activity_revision: 1, active_run_ids: ['r-2'],
      chain: [{ status: stepStatus }, { status: 'pending' }],
    });
  });

  it('rejects stale orchestration CAS for Session-changing Run mutations without writes', () => {
    const store = setup();
    const sessionBefore = store.readSessionV30('s-1');
    const runBefore = store.readRunV30('s-1', 'r-1');
    expect(() => mutateRunV3(store, {
      ...identity('req-stale-cancel'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 9, toStatus: 'cancelled',
    })).toThrow(expect.objectContaining({
      code: 'ORCHESTRATION_REVISION_CONFLICT', expected_revision: 9, current_revision: 0,
    }));
    expect(store.readSessionV30('s-1')).toEqual(sessionBefore);
    expect(store.readRunV30('s-1', 'r-1')).toEqual(runBefore);
    expect(store.readRequestReceiptV20('s-1', 'req-stale-cancel')).toBeNull();
  });

  it('returns actionable continuations for blocked and running recovery states', () => {
    const store = setup();
    const blocked = mutateRunV3(store, {
      ...identity('req-block'), runId: 'r-1', expectedRunRevision: 0, toStatus: 'blocked',
    });
    expect(blocked.transition.result).toMatchObject({ continuation: { operation: 'check' } });
    const running = mutateRunV3(store, {
      ...identity('req-running'), runId: 'r-1', expectedRunRevision: 1, toStatus: 'running',
    });
    expect(running.transition.result).toMatchObject({
      continuation: {
        operation: 'complete',
        revision_requirements: { expected_orchestration_revision: 0, expected_run_revision: 2 },
      },
    });
  });

  it('validates and derives retry lineage from locked source state', () => {
    const store = setup();
    mutateRunV3(store, {
      ...identity('req-source-failed'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, toStatus: 'failed', verdict: 'needs_retry',
    });
    const result = createRunningRunV3(store, {
      ...identity('req-retry'), expectedOrchestrationRevision: 1,
      run: { ...run('r-3', 'step-1', 'pending'), retry_of_run_id: 'r-1', attempt: 2 },
    });
    expect(result.status).toBe('applied');
    expect(store.readRunV30('s-1', 'r-3')).toMatchObject({
      status: 'running', revision: 1, retry_of_run_id: 'r-1', attempt: 2,
    });
    expect(store.readSessionV30('s-1')).toMatchObject({
      orchestration_revision: 2, chain: [{ status: 'running', run_ids: ['r-1', 'r-3'] }, { status: 'pending' }],
    });
  });

  it('rejects forged retry attempts atomically', () => {
    const store = setup();
    mutateRunV3(store, {
      ...identity('req-source-forged'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, toStatus: 'failed', verdict: 'needs_retry',
    });
    const before = store.readSessionV30('s-1');
    expect(() => createRunningRunV3(store, {
      ...identity('req-forged-retry'), expectedOrchestrationRevision: 1,
      run: { ...run('r-3', 'step-1', 'pending'), retry_of_run_id: 'r-1', attempt: 9 },
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(store.readSessionV30('s-1')).toEqual(before);
    expect(store.readRequestReceiptV20('s-1', 'req-forged-retry')).toBeNull();
    expect(() => store.readRunV30('s-1', 'r-3')).toThrow();
  });

  it('rejects invalid and cross-step retry sources inside the transaction', () => {
    const invalidStore = setup();
    const invalidBefore = invalidStore.readSessionV30('s-1');
    expect(() => createRunningRunV3(invalidStore, {
      ...identity('req-invalid-source'), expectedOrchestrationRevision: 0,
      run: { ...run('r-3', 'step-1', 'pending'), retry_of_run_id: 'r-1', attempt: 2 },
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(invalidStore.readSessionV30('s-1')).toEqual(invalidBefore);

    const crossStepStore = setup();
    mutateRunV3(crossStepStore, {
      ...identity('req-cross-source-failed'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, toStatus: 'failed', verdict: 'needs_retry',
    });
    const crossStepBefore = crossStepStore.readSessionV30('s-1');
    expect(() => createRunningRunV3(crossStepStore, {
      ...identity('req-cross-step'), expectedOrchestrationRevision: 1,
      run: { ...run('r-3', 'step-2', 'pending'), retry_of_run_id: 'r-1', attempt: 2 },
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(crossStepStore.readSessionV30('s-1')).toEqual(crossStepBefore);
    expect(crossStepStore.readRequestReceiptV20('s-1', 'req-cross-step')).toBeNull();
  });

  it('replays Run creation when only server-generated timestamps differ', () => {
    const store = setup();
    // Chain-head fixture: no predecessor, so creation is not gated by
    // publication authority (audit H1-① keeps chain ordering intact).
    store.writeSessionV30({
      ...session(),
      chain: [{
        step_id: 'step-1', command: 'implement', args: [], status: 'pending',
        run_ids: [], goal_ref: null, decision_ref: null, decision_refs: [],
      }],
      active_run_ids: [],
    });
    const first = createRunningRunV3(store, {
      ...identity('req-create-replay'), expectedOrchestrationRevision: 0,
      requestOperation: 'run-create',
      run: { ...run('r-3', 'step-1', 'pending'), created_at: '2026-08-12T01:00:00.000Z' },
    });
    const replayed = createRunningRunV3(store, {
      ...identity('req-create-replay'), expectedOrchestrationRevision: 0,
      requestOperation: 'run-create',
      run: { ...run('r-3', 'step-1', 'pending'), created_at: '2026-08-12T02:00:00.000Z' },
    });
    expect(replayed).toEqual({ status: 'replayed', transition: first.transition });
    expect(store.readRunV30('s-1', 'r-3').created_at).toBe('2026-08-12T01:00:00.000Z');
    expect(store.readSessionV30('s-1')).toMatchObject({ orchestration_revision: 1, activity_revision: 1 });
  });

  it('rejects reuse of an existing terminal Run ID without changing its bytes', () => {
    const store = setup();
    const existing = { ...run('r-1', 'step-1', 'sealed'), revision: 4, verdict: 'done' as const,
      summary: 'immutable', ended_at: '2026-08-12T00:10:00.000Z', sealed_at: '2026-08-12T00:11:00.000Z' };
    store.writeRunV30(existing);
    const before = store.readRunV30('s-1', 'r-1');
    expect(() => createRunV3(store, {
      ...identity('req-reuse-id'), expectedOrchestrationRevision: 0, run: run('r-1', 'step-1', 'pending'),
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(store.readRunV30('s-1', 'r-1')).toEqual(before);
    expect(store.readSessionV30('s-1').activity_revision).toBe(0);
  });

  it('rejects Run creation while the Session is completed and blocks terminal work too', () => {
    const store = setup('completed');
    const candidate = run('r-3', 'step-2', 'pending');
    expect(() => createRunV3(store, {
      ...identity('req-create'), expectedOrchestrationRevision: 0, run: candidate,
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(() => completeRunAndAdvance(store, {
      ...identity('req-complete'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'done', verdict: 'done',
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(store.readRunV30('s-1', 'r-1').status).toBe('running');
    expect(store.readSessionV30('s-1')).toMatchObject({
      status: 'completed', orchestration_revision: 0,
      chain: [{ status: 'running' }, { status: 'pending' }],
    });
  });

  it('completes and seals a Run without allocating the next Run', () => {
    const store = setup();
    const result = completeRunAndAdvance(store, {
      ...identity('req-complete-advance'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'implemented', verdict: 'done',
    });
    expect(result.status).toBe('applied');
    expect(result.transition.result).toMatchObject({
      operation: 'run-complete-and-seal', status: 'sealed',
      next: {
        suggest_only: true,
        command: 'maestro run next --session s-1 --actor <actor-id> --expected-orchestration-revision 1 --json',
      },
      continuation: {
        operation: 'next', locator: { session_id: 's-1', run_id: null },
        revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
      },
    });
    expect(store.readRunV30('s-1', 'r-1')).toMatchObject({
      status: 'sealed', revision: 1, ended_at: '2026-08-12T01:00:00.000Z', sealed_at: '2026-08-12T01:00:00.000Z',
    });
    expect(store.readSessionV30('s-1')).toMatchObject({
      orchestration_revision: 1, activity_revision: 1, active_run_ids: ['r-2'],
      chain: [{ status: 'completed' }, { status: 'pending' }],
    });
    expect(() => store.readRunV30('s-1', 'r-next')).toThrow();
  });

  it('publishes outputs, aliases, sealed authority, and receipts in one fault-atomic batch', () => {
    const store = setup();
    configureRequiredOutput(store);
    const paths = [
      join(store.sessionDir('s-1'), 'session.json'),
      join(store.runDir('s-1', 'r-1'), 'run.json'),
      join(store.sessionDir('s-1'), 'artifacts.json'),
    ];
    const before = new Map(paths.map(path => [path, readFileSync(path, 'utf8')]));
    const original = (SessionStore.prototype as any).writeBatchUnlocked;
    const fault = vi.spyOn(SessionStore.prototype as any, 'writeBatchUnlocked')
      .mockImplementationOnce(() => { throw new Error('injected v3 completion batch fault'); });
    const input = {
      ...identity('req-atomic-publication'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'published', verdict: 'done' as const,
    };
    expect(() => completeRunAndAdvance(store, input)).toThrow(/injected v3 completion batch fault/);
    fault.mockRestore();
    for (const [path, bytes] of before) expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(store.readRequestReceiptV20('s-1', input.requestId)).toBeNull();
    expect(store.listTransitionReceiptsV20('s-1')).toEqual([]);

    const batches: string[][] = [];
    const capture = vi.spyOn(SessionStore.prototype as any, 'writeBatchUnlocked')
      .mockImplementation(function (this: SessionStore, writes: Array<{ path: string }>) {
        batches.push(writes.map(write => write.path));
        return original.call(this, writes);
      });
    const completed = completeRunAndAdvance(store, input);
    capture.mockRestore();
    expect(batches).toHaveLength(1);
    for (const path of paths) expect(batches[0]).toContain(path);
    expect(batches[0].some(path => path.includes(join('receipts', 'requests')))).toBe(true);
    expect(batches[0].some(path => path.includes(join('receipts', 'transitions')))).toBe(true);

    const runAfter = store.readRunV30('s-1', 'r-1');
    const registry = JSON.parse(readFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), 'utf8'));
    expect(runAfter).toMatchObject({
      status: 'sealed', output_refs: [expect.stringMatching(/^ART-/)],
      primary_artifact_id: expect.stringMatching(/^ART-/),
    });
    expect(registry).toMatchObject({
      revision: 1,
      aliases: { 'current-result': runAfter.primary_artifact_id },
      artifacts: { [runAfter.primary_artifact_id!]: { producer_run_id: 'r-1', status: 'sealed' } },
    });
    expect(completed.transition.result).toMatchObject({
      artifact_publication: {
        authority: 'transition-receipt/2.0', artifact_registry_revision: 1,
        artifact_ids: runAfter.output_refs, primary_artifact_id: runAfter.primary_artifact_id,
      },
    });
  });

  it('replays atomic completion without republishing or changing canonical bytes', () => {
    const store = setup();
    configureRequiredOutput(store);
    const input = {
      ...identity('req-completion-replay'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'published once', verdict: 'done' as const,
    };
    const applied = completeRunAndAdvance(store, input);
    const canonicalPaths = [
      join(store.sessionDir('s-1'), 'session.json'),
      join(store.runDir('s-1', 'r-1'), 'run.json'),
      join(store.sessionDir('s-1'), 'artifacts.json'),
    ];
    const committed = canonicalPaths.map(path => readFileSync(path, 'utf8'));
    const replayed = completeRunAndAdvance(store, input);
    expect(replayed).toEqual({ status: 'replayed', transition: applied.transition });
    expect(canonicalPaths.map(path => readFileSync(path, 'utf8'))).toEqual(committed);
    expect(store.listTransitionReceiptsV20('s-1')).toHaveLength(1);
    expect(JSON.parse(committed[2])).toMatchObject({ revision: 1 });
  });

  it('fences run next on sealed predecessor publication authority', () => {
    const missingAuthority = setup();
    const missingSession = missingAuthority.readSessionV30('s-1');
    missingAuthority.writeSessionV30({
      ...missingSession,
      chain: missingSession.chain.map((step, index) => ({ ...step, status: index === 0 ? 'completed' : 'pending' })),
      active_run_ids: ['r-2'],
    });
    missingAuthority.writeRunV30({
      ...run('r-1', 'step-1', 'sealed'), revision: 1, verdict: 'done', summary: 'legacy completion',
      ended_at: '2026-08-12T00:30:00.000Z', sealed_at: '2026-08-12T00:30:00.000Z',
    });
    expect(() => createRunningRunV3(missingAuthority, {
      ...identity('req-next-without-authority'), expectedOrchestrationRevision: 0,
      run: run('r-3', 'step-2', 'pending'),
    })).toThrow(/lacks unique artifact publication authority/);
    expect(() => missingAuthority.readRunV30('s-1', 'r-3')).toThrow();

    const store = setup();
    completeRunAndAdvance(store, {
      ...identity('req-predecessor-complete'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'sealed predecessor', verdict: 'done',
    });
    const created = createRunningRunV3(store, {
      ...identity('req-next-with-authority'), expectedOrchestrationRevision: 1,
      run: run('r-3', 'step-2', 'pending'),
    });
    expect(created.status).toBe('applied');
    expect(store.readRunV30('s-1', 'r-3')).toMatchObject({ status: 'running', revision: 1 });
  });

  it('recovers a pre-upgrade completed Run by publishing and sealing terminal authority only', () => {
    const store = setup();
    configureRequiredOutput(store);
    const current = store.readSessionV30('s-1');
    store.writeSessionV30({
      ...current,
      orchestration_revision: 1,
      chain: current.chain.map((step, index) => ({ ...step, status: index === 0 ? 'completed' : 'pending' })),
      active_run_ids: ['r-2'],
    });
    store.writeRunV30({
      ...run('r-1', 'step-1', 'completed'), revision: 1, verdict: 'done', summary: 'old completion',
      ended_at: '2026-08-12T00:30:00.000Z',
    });
    const recovered = recoverSealRunV3(store, {
      ...identity('req-recovery-seal'), runId: 'r-1', expectedRunRevision: 1,
    });
    expect(recovered.transition.result).toMatchObject({
      operation: 'run-recovery-seal', status: 'sealed',
      artifact_publication: { authority: 'transition-receipt/2.0', artifact_ids: [expect.stringMatching(/^ART-/)] },
    });
    expect(store.readRunV30('s-1', 'r-1')).toMatchObject({ status: 'sealed', revision: 2 });
    const next = createRunningRunV3(store, {
      ...identity('req-next-after-recovery'), expectedOrchestrationRevision: 1,
      run: run('r-3', 'step-2', 'pending'),
    });
    expect(next.status).toBe('applied');
  });

  it('rejects missing required outputs before staging any completion authority', () => {
    const store = setup();
    configureRequiredOutput(store, false);
    const sessionBefore = readFileSync(join(store.sessionDir('s-1'), 'session.json'), 'utf8');
    const runBefore = readFileSync(join(store.runDir('s-1', 'r-1'), 'run.json'), 'utf8');
    const artifactsBefore = readFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), 'utf8');
    expect(() => completeRunAndAdvance(store, {
      ...identity('req-missing-output'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 0, summary: 'invalid', verdict: 'done',
    })).toThrow(/Missing required contract v2 output/);
    expect(readFileSync(join(store.sessionDir('s-1'), 'session.json'), 'utf8')).toBe(sessionBefore);
    expect(readFileSync(join(store.runDir('s-1', 'r-1'), 'run.json'), 'utf8')).toBe(runBefore);
    expect(readFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), 'utf8')).toBe(artifactsBefore);
    expect(store.readRequestReceiptV20('s-1', 'req-missing-output')).toBeNull();
  });

  it('does not half-commit when complete-and-advance validation fails', () => {
    const store = setup();
    expect(() => completeRunAndAdvance(store, {
      ...identity('req-fail'), runId: 'r-1', expectedRunRevision: 0,
      expectedOrchestrationRevision: 99, summary: 'implemented', verdict: 'done',
    })).toThrow(expect.objectContaining({ code: 'ORCHESTRATION_REVISION_CONFLICT' }));
    expect(store.readRunV30('s-1', 'r-1')).toMatchObject({ status: 'running', revision: 0 });
    expect(store.readSessionV30('s-1')).toMatchObject({ orchestration_revision: 0, activity_revision: 0 });
    expect(store.readRequestReceiptV20('s-1', 'req-fail')).toBeNull();
  });

  it('derives Session completion blockers from locked authority instead of caller input', () => {
    const store = setup();
    expect(() => completeSessionV3(store, {
      ...identity('req-session-blocked'), expectedOrchestrationRevision: 0,
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    expect(store.readSessionV30('s-1')).toMatchObject({ status: 'open', orchestration_revision: 0, activity_revision: 0 });
    expect(store.readRequestReceiptV20('s-1', 'req-session-blocked')).toBeNull();
  });

  it('completes a Session atomically when locked authority has no blockers', () => {
    const store = setup();
    const current = store.readSessionV30('s-1');
    store.writeSessionV30({
      ...current,
      chain: current.chain.map(step => ({ ...step, status: 'completed' })),
      active_run_ids: [],
    });
    for (const [runId, stepId] of [['r-1', 'step-1'], ['r-2', 'step-2']] as const) {
      store.writeRunV30({
        ...run(runId, stepId, 'sealed'), revision: 2, verdict: 'done', summary: 'done',
        ended_at: '2026-08-12T00:02:00.000Z', sealed_at: '2026-08-12T00:03:00.000Z',
      });
    }
    const result = completeSessionV3(store, {
      ...identity('req-session-complete'), expectedOrchestrationRevision: 0,
    });
    expect(result.status).toBe('applied');
    expect(store.readSessionV30('s-1')).toMatchObject({
      status: 'completed', orchestration_revision: 1, activity_revision: 1,
      completed_at: '2026-08-12T01:00:00.000Z',
    });
  });
});
