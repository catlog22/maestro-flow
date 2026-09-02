import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerKnowledgeCommand } from '../../commands/knowledge.js';
import { MaestroGraph } from '../../graph/kg/engine.js';
import { reconcileRunKnowledgeSync, reconciliationPath, resolveKnowledgeCandidate } from '../../knowledge/reconcile.js';
import { WikiIndexer } from '../../../dashboard/src/server/wiki/wiki-indexer.js';

vi.setConfig({ testTimeout: 60_000 });
import {
  promoteSessionKnowledge,
  readRunKnowledgeDelta,
  readSessionKnowledgeDelta,
  runKnowledgeDeltaPath,
  sessionReconciliationPath,
  stageRunKnowledgeCandidate,
} from '../knowledge.js';
import { resolveWriteAuthority, touchChannel } from '../knowledge-identity.js';
import { stageSessionKnowledgeCandidate } from '../session-knowledge.js';
import type { RunV30, SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import { completeRunAndAdvance } from './mutation-engine.js';

const roots: string[] = [];

const EMPTY_REPORT = `---
verdict: ready
summary: v3 knowledge fixture
constraints: []
decisions: []
concerns: []
next: []
details: {}
---
V3 knowledge fixture.
`;

function candidateReport(content: string): string {
  return `---
verdict: ready
summary: v3 candidate completion
constraints: []
decisions:
  - text: "${content}"
    status: accepted
concerns: []
next: []
details: {}
---
V3 candidate completion.
`;
}

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-knowledge-lifecycle-v3-'));
  roots.push(root);
  const workflowRoot = join(root, '.workflow');
  mkdirSync(workflowRoot, { recursive: true });
  writeFileSync(join(workflowRoot, 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }, null, 2)}\n`, 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'evidence.ts'), '// immutable v3 evidence\n', 'utf8');
  return root;
}

function session(
  sessionId: string,
  runId: string,
  options: { active?: boolean; orchestrationRevision?: number } = {},
): SessionStateV30 {
  const active = options.active ?? true;
  return {
    schema_version: 'session/3.0',
    session_id: sessionId,
    objective: 'exercise complete v3 knowledge governance',
    definition_of_done: 'review, resolve, promote, and replay pass',
    status: 'open',
    orchestration_revision: options.orchestrationRevision ?? 0,
    activity_revision: options.orchestrationRevision ?? 0,
    chain: [{
      step_id: 'step-1',
      command: 'knowledge-v3',
      args: [],
      status: active ? 'running' : 'completed',
      run_ids: [runId],
      goal_ref: null,
      decision_ref: null,
      decision_refs: [],
    }],
    decisions: [],
    active_run_ids: active ? [runId] : [],
    artifacts_ref: 'artifacts.json',
    evidence_ref: 'evidence.json',
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: active ? '2026-08-16T00:00:00.000Z' : '2026-08-16T00:02:00.000Z',
    completed_at: null,
    archived_at: null,
  };
}

function run(
  sessionId: string,
  runId: string,
  status: RunV30['status'] = 'running',
): RunV30 {
  const terminal = status === 'sealed';
  return {
    schema_version: 'run/3.0',
    run_id: runId,
    session_id: sessionId,
    step_id: 'step-1',
    parent_run_id: null,
    retry_of_run_id: null,
    attempt: 1,
    command: 'knowledge-v3',
    args: [],
    goal: null,
    status,
    revision: terminal ? 1 : 0,
    actor_id: 'actor-v3',
    input_refs: [],
    output_refs: [],
    primary_artifact_id: null,
    verdict: terminal ? 'done' : null,
    summary: terminal ? 'sealed v3 knowledge source' : null,
    legacy_execution_generation: null,
    created_at: '2026-08-16T00:00:00.000Z',
    started_at: '2026-08-16T00:00:30.000Z',
    ended_at: terminal ? '2026-08-16T00:02:00.000Z' : null,
    sealed_at: terminal ? '2026-08-16T00:02:00.000Z' : null,
  };
}

function setup(sessionId: string, runId: string): { root: string; store: SessionStore } {
  const root = projectRoot();
  const store = new SessionStore(root);
  store.writeSessionV30(session(sessionId, runId));
  writeFileSync(join(store.sessionDir(sessionId), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`, 'utf8');
  store.writeRunV30(run(sessionId, runId));
  mkdirSync(store.runDir(sessionId, runId), { recursive: true });
  writeFileSync(join(store.runDir(sessionId, runId), 'report.md'), EMPTY_REPORT, 'utf8');
  return { root, store };
}

function sealFixtureRun(store: SessionStore, sessionId: string, runId: string): void {
  store.writeRunV30(run(sessionId, runId, 'sealed'));
  store.writeSessionV30(session(sessionId, runId, { active: false, orchestrationRevision: 1 }));
}

function completionIdentity(sessionId: string, requestId: string) {
  return {
    sessionId,
    requestId,
    actorId: 'actor-v3',
    reason: 'exercise v3 completion reconciliation',
    recordedAt: '2026-08-16T00:03:00.000Z',
  };
}

async function invokeKnowledge(root: string, ...args: string[]): Promise<Record<string, unknown>> {
  const logs: string[] = [];
  const errors: string[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const logSpy = vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
  try {
    const program = new Command().exitOverride();
    registerKnowledgeCommand(program);
    await program.parseAsync([
      'node', 'maestro', 'knowledge', ...args, '--workflow-root', root,
    ]);
    if (process.exitCode) throw new Error(errors.join('\n') || `knowledge command failed: ${args.join(' ')}`);
    const output = logs.at(-1);
    if (!output) throw new Error(`knowledge command produced no JSON: ${args.join(' ')}`);
    return JSON.parse(output) as Record<string, unknown>;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = previousExitCode;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('session/3.0 knowledge lifecycle', () => {
  it('executes run-origin stage, record, review refresh, resolution, promotion, and replay', async () => {
    const { root, store } = setup('s-run-origin', 'run-origin');
    const sessionBefore = readFileSync(join(store.sessionDir('s-run-origin'), 'session.json'), 'utf8');
    const staged = await invokeKnowledge(
      root,
      'stage', 'knowhow', 'V3 run-origin recipe',
      'Keep v3 Run knowledge sidecars behind strict record authority.',
      '--run', 'run-origin', '--session', 's-run-origin', '--json',
    ) as { candidate_id: string };
    await invokeKnowledge(
      root,
      'record', 'spec:v3-run-consumption', '--signal', 'validated', '--source', 'manual',
      '--run', 'run-origin', '--session', 's-run-origin', '--allow-unknown', '--json',
    );
    expect(readRunKnowledgeDelta(store, 's-run-origin', 'run-origin').inputs)
      .toEqual([expect.objectContaining({ knowledge_id: 'spec:v3-run-consumption' })]);

    sealFixtureRun(store, 's-run-origin', 'run-origin');
    const sealedRunBefore = readFileSync(join(store.runDir('s-run-origin', 'run-origin'), 'run.json'), 'utf8');
    const review = await invokeKnowledge(root, 'review', 's-run-origin', '--refresh', '--json');
    expect(review).toMatchObject({
      candidates: [expect.objectContaining({
        candidate_id: staged.candidate_id,
        review: expect.objectContaining({ freshness: 'fresh' }),
      })],
    });

    const promoted = await invokeKnowledge(
      root,
      'promote', 's-run-origin', '--resolve', staged.candidate_id,
      '--as', 'unique', '--reason', 'Reviewed as a new v3 Run-origin recipe', '--json',
    );
    expect(promoted).toMatchObject({
      promoted: [expect.objectContaining({ candidate_id: staged.candidate_id, outcome: 'created' })],
    });
    const replay = await invokeKnowledge(
      root,
      'promote', 's-run-origin', '--candidate', staged.candidate_id, '--json',
    );
    expect(replay).toMatchObject({
      promoted: [],
      already_promoted: [{ candidate_id: staged.candidate_id }],
    });
    const promotedItem = (promoted.promoted as Array<{
      candidate_id: string; promoted_id: string; outcome: string;
    }>)[0];
    const graph = await MaestroGraph.init(root);
    try {
      await graph.indexKnowledge({ sources: ['knowhow'] });
      const kgResult = graph.searchUnified('V3 run-origin recipe', {
        sourceTypes: ['knowhow'], includeCode: false, includeKnowledge: true, limit: 10,
      });
      expect(kgResult.directMatches.some(match => match.node.name === 'V3 run-origin recipe')).toBe(true);
    } finally {
      graph.close();
    }

    const terminalSession = store.readSessionV30('s-run-origin');
    store.writeSessionV30({
      ...terminalSession,
      status: 'completed',
      updated_at: '2026-08-16T00:04:00.000Z',
      completed_at: '2026-08-16T00:04:00.000Z',
    });
    const wiki = await new WikiIndexer({
      workflowRoot: join(root, '.workflow'),
      persistence: 'memory-only',
    }).get();
    const sessionEntry = wiki.byId['session-s-run-origin'];
    const runEntry = wiki.byId['session-run-s-run-origin-run-origin'];
    const promotedEntry = wiki.byId[promotedItem.promoted_id];
    expect(sessionEntry).toMatchObject({ status: 'completed', ext: expect.objectContaining({ runCount: 1 }) });
    expect(runEntry).toMatchObject({ status: 'completed', sourceRef: 'run-origin' });
    expect(promotedEntry).toBeDefined();
    expect(sessionEntry.related).toContain(promotedEntry.id);
    expect(promotedEntry.related).toContain(sessionEntry.id);

    expect(readRunKnowledgeDelta(store, 's-run-origin', 'run-origin').candidates[0].status)
      .toBe('promoted');
    expect(readFileSync(join(store.runDir('s-run-origin', 'run-origin'), 'run.json'), 'utf8'))
      .toBe(sealedRunBefore);
    expect(readFileSync(join(store.sessionDir('s-run-origin'), 'session.json'), 'utf8'))
      .not.toBe(sessionBefore);
  });

  it('executes session-origin stage, record, review refresh, resolution, promotion, and replay', async () => {
    const { root, store } = setup('s-session-origin', 'run-session-host');
    const authorityBefore = readFileSync(join(store.sessionDir('s-session-origin'), 'session.json'), 'utf8');
    const staged = await invokeKnowledge(
      root,
      'stage', 'knowhow', 'V3 session-origin recipe',
      'Bind run-less v3 knowledge to immutable Session evidence.',
      '--session', 's-session-origin', '--evidence', 'src/evidence.ts:1', '--json',
    ) as { candidate_id: string };
    await invokeKnowledge(
      root,
      'record', 'spec:v3-session-consumption', '--signal', 'consumed', '--source', 'load',
      '--session', 's-session-origin', '--allow-unknown', '--json',
    );
    const review = await invokeKnowledge(root, 'review', 's-session-origin', '--refresh', '--json');
    expect(review).toMatchObject({
      candidates: [expect.objectContaining({
        candidate_id: staged.candidate_id,
        origin: 'session',
        review: expect.objectContaining({ freshness: 'fresh' }),
      })],
    });

    await expect(invokeKnowledge(
      root,
      'promote', 's-session-origin', '--resolve', staged.candidate_id,
      '--as', 'unique', '--reason', 'Reviewed as a new v3 Session-origin recipe', '--json',
    )).rejects.toThrow(/active Runs/);
    sealFixtureRun(store, 's-session-origin', 'run-session-host');
    const sealedAuthority = readFileSync(join(store.sessionDir('s-session-origin'), 'session.json'), 'utf8');
    const promoted = await invokeKnowledge(
      root,
      'promote', 's-session-origin', '--candidate', staged.candidate_id, '--json',
    );
    expect(promoted).toMatchObject({
      promoted: [expect.objectContaining({ candidate_id: staged.candidate_id, outcome: 'created' })],
    });
    const replay = await invokeKnowledge(
      root,
      'promote', 's-session-origin', '--candidate', staged.candidate_id, '--json',
    );
    expect(replay).toMatchObject({
      promoted: [],
      already_promoted: [{ candidate_id: staged.candidate_id }],
    });
    const delta = readSessionKnowledgeDelta(store, 's-session-origin', true);
    expect(delta.inputs).toEqual([
      expect.objectContaining({ knowledge_id: 'spec:v3-session-consumption', source: 'load' }),
    ]);
    expect(delta.candidates[0]).toMatchObject({
      status: 'promoted',
      promoted_id: expect.stringMatching(/^knowhow-tip-/),
    });
    expect(readFileSync(join(store.sessionDir('s-session-origin'), 'session.json'), 'utf8'))
      .not.toBe(authorityBefore);
    expect(readFileSync(join(store.sessionDir('s-session-origin'), 'session.json'), 'utf8'))
      .toBe(sealedAuthority);
  });

  it('reconciles candidate-bearing frontmatter inside completion and replays before re-reading it', () => {
    const { root, store } = setup('s-complete', 'run-complete');
    const reportPath = join(store.runDir('s-complete', 'run-complete'), 'report.md');
    writeFileSync(reportPath, candidateReport('Use the preflight candidate'), 'utf8');
    const stale = reconcileRunKnowledgeSync(
      root,
      's-complete',
      'run-complete',
      { summary: 'old', verdict: 'ready', constraints: [], decisions: [{ text: 'Use the preflight candidate', status: 'accepted' }], concerns: [], next: [], details: {} },
    );
    writeFileSync(reportPath, candidateReport('Use the in-transaction candidate'), 'utf8');

    const first = completeRunAndAdvance(store, {
      ...completionIdentity('s-complete', 'req-complete-v3-knowledge'),
      runId: 'run-complete',
      expectedRunRevision: 0,
      expectedOrchestrationRevision: 0,
      verdict: 'done',
      knowledgeReconciliation: stale,
    });
    expect(first.status).toBe('applied');
    const delta = readRunKnowledgeDelta(store, 's-complete', 'run-complete', true);
    expect(delta.candidates.map(candidate => candidate.content))
      .toEqual(['Use the in-transaction candidate']);

    writeFileSync(reportPath, '{broken after successful completion', 'utf8');
    const replay = completeRunAndAdvance(store, {
      ...completionIdentity('s-complete', 'req-complete-v3-knowledge'),
      runId: 'run-complete',
      expectedRunRevision: 0,
      expectedOrchestrationRevision: 0,
      verdict: 'done',
      knowledgeReconciliation: null,
    });
    expect(replay.status).toBe('replayed');
  });

  it('preserves a fresh human resolution when completion receives a generated receipt', async () => {
    const { root, store } = setup('s-preserve-resolution', 'run-preserve-resolution');
    const content = 'Preserve the reviewed v3 reconciliation';
    const reportPath = join(store.runDir('s-preserve-resolution', 'run-preserve-resolution'), 'report.md');
    writeFileSync(reportPath, candidateReport(content), 'utf8');
    stageRunKnowledgeCandidate(root, 'run-preserve-resolution', {
      target: 'spec', title: content, content, category: 'arch',
    }, 's-preserve-resolution');

    const review = await invokeKnowledge(root, 'review', 's-preserve-resolution', '--refresh', '--json') as {
      candidates: Array<{ candidate_id: string }>;
    };
    const candidateId = review.candidates[0].candidate_id;
    resolveKnowledgeCandidate(root, 's-preserve-resolution', candidateId, 'unique', {
      reason: 'Human review confirmed this candidate is unique',
    });
    const frontmatter = {
      summary: 'v3 candidate completion',
      verdict: 'ready',
      constraints: [],
      decisions: [{ text: content, status: 'accepted' as const }],
      concerns: [],
      next: [],
      details: {},
    };
    const generated = reconcileRunKnowledgeSync(
      root,
      's-preserve-resolution',
      'run-preserve-resolution',
      frontmatter,
    );
    expect(generated.candidates[0].resolution).toBeNull();

    const completed = completeRunAndAdvance(store, {
      ...completionIdentity('s-preserve-resolution', 'req-preserve-resolution'),
      runId: 'run-preserve-resolution',
      expectedRunRevision: 0,
      expectedOrchestrationRevision: 0,
      verdict: 'done',
      knowledgeReconciliation: generated,
    });
    expect(completed.status).toBe('applied');
    const persisted = JSON.parse(readFileSync(
      reconciliationPath(store, 's-preserve-resolution', 'run-preserve-resolution'),
      'utf8',
    )) as { candidates: Array<{
      candidate_id: string;
      resolution: { status: string; reason: string } | null;
    }> };
    expect(persisted.candidates.find(candidate => candidate.candidate_id === candidateId)?.resolution)
      .toMatchObject({
        status: 'confirmed',
        reason: 'Human review confirmed this candidate is unique',
      });
  });

  it('preserves confirmed Run resolution across an unchanged review refresh', async () => {
    const { root, store } = setup('s-refresh-resolution', 'run-refresh-resolution');
    const staged = stageRunKnowledgeCandidate(root, 'run-refresh-resolution', {
      target: 'knowhow',
      title: 'Refresh resolution',
      content: 'An unchanged refresh must preserve confirmed human adjudication',
    }, 's-refresh-resolution');
    sealFixtureRun(store, 's-refresh-resolution', 'run-refresh-resolution');
    await invokeKnowledge(root, 'review', 's-refresh-resolution', '--refresh', '--json');
    resolveKnowledgeCandidate(root, 's-refresh-resolution', staged.candidate_id, 'unique', {
      reason: 'Human confirmed the candidate remains unique',
    });

    await invokeKnowledge(root, 'review', 's-refresh-resolution', '--refresh', '--json');
    const receipt = JSON.parse(readFileSync(
      reconciliationPath(store, 's-refresh-resolution', 'run-refresh-resolution'),
      'utf8',
    )) as { candidates: Array<{ candidate_id: string; resolution: { status: string; reason: string } | null }> };
    expect(receipt.candidates.find(candidate => candidate.candidate_id === staged.candidate_id)?.resolution)
      .toMatchObject({
        status: 'confirmed',
        reason: 'Human confirmed the candidate remains unique',
      });
  });

  it('rejects a supersession policy changed after planning but before v3 commit', async () => {
    const { root, store } = setup('s-policy-toctou', 'run-policy-toctou');
    const knowhowDir = join(root, '.workflow', 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    const oldPath = join(knowhowDir, 'TIP-20260816-policy-target.md');
    const oldId = 'knowhow-tip-20260816-policy-target';
    writeFileSync(oldPath, [
      '---',
      'title: Policy target',
      'type: tip',
      'explicitId: tip-20260816-policy-target',
      'status: active',
      '---',
      '',
      'Old policy target content.',
      '',
    ].join('\n'), 'utf8');
    const staged = stageRunKnowledgeCandidate(root, 'run-policy-toctou', {
      target: 'knowhow',
      title: 'Policy target',
      content: 'Replacement policy target content.',
    }, 's-policy-toctou');
    sealFixtureRun(store, 's-policy-toctou', 'run-policy-toctou');
    await invokeKnowledge(root, 'review', 's-policy-toctou', '--refresh', '--json');
    resolveKnowledgeCandidate(root, 's-policy-toctou', staged.candidate_id, 'supersede', {
      targetId: oldId,
      reason: 'Initial reviewed supersession decision',
    });
    const receiptPath = reconciliationPath(store, 's-policy-toctou', 'run-policy-toctou');

    expect(() => promoteSessionKnowledge(root, 's-policy-toctou', {
      candidateIds: [staged.candidate_id],
      _beforeFinalSessionValidation: () => {
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
          candidates: Array<Record<string, unknown>>;
        };
        const policy = receipt.candidates.find(candidate => candidate.candidate_id === staged.candidate_id);
        if (!policy) throw new Error('missing TOCTOU policy');
        policy.disposition = 'unique';
        policy.canonical_id = null;
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      },
      _finalSessionValidation: () => undefined,
    })).toThrow(/reconciliation policy changed before v3 promotion commit/);
    expect(readFileSync(oldPath, 'utf8')).toContain('status: active');
    expect(readRunKnowledgeDelta(store, 's-policy-toctou', 'run-policy-toctou', true).candidates[0].status)
      .toBe('pending');
  });

  it('fails write authority closed when one v3 Session has two live Run channels', () => {
    const { root, store } = setup('s-multi-run', 'run-a');
    const state = store.readSessionV30('s-multi-run');
    state.active_run_ids = ['run-a', 'run-b'];
    state.chain[0].run_ids = ['run-a', 'run-b'];
    store.writeSessionV30(state);
    store.writeRunV30(run('s-multi-run', 'run-b'));
    touchChannel(root, {
      identity: 'host-run-a',
      hostKind: 'hook',
      context: { kind: 'run', session_id: 's-multi-run', run_id: 'run-a' },
    });
    touchChannel(root, {
      identity: 'host-run-b',
      hostKind: 'hook',
      context: { kind: 'run', session_id: 's-multi-run', run_id: 'run-b' },
    });

    expect(() => resolveWriteAuthority({ projectRoot: root, store, env: {} }))
      .toThrow(/ambiguous|multiple active Runs/i);
  });

  it('blocks a same-ID candidate when either origin reconciliation is suppressed', async () => {
    const { root, store } = setup('s-origin-policy', 'run-origin-policy');
    const content = 'A deterministic candidate shared by both origins';
    const runCandidate = stageRunKnowledgeCandidate(root, 'run-origin-policy', {
      target: 'knowhow', title: 'Run origin', content,
    }, 's-origin-policy');
    const sessionCandidate = stageSessionKnowledgeCandidate(root, 's-origin-policy', {
      target: 'knowhow', title: 'Session origin', content, evidenceRefs: ['src/evidence.ts:1'],
    });
    expect(sessionCandidate.candidate_id).toBe(runCandidate.candidate_id);
    sealFixtureRun(store, 's-origin-policy', 'run-origin-policy');
    await invokeKnowledge(root, 'review', 's-origin-policy', '--refresh', '--json');

    const runReceiptPath = reconciliationPath(store, 's-origin-policy', 'run-origin-policy');
    const runReceipt = JSON.parse(readFileSync(runReceiptPath, 'utf8')) as {
      candidates: Array<{
        candidate_id: string;
        disposition: string;
        promotion_eligibility: string;
      }>;
    };
    const runPolicy = runReceipt.candidates.find(
      candidate => candidate.candidate_id === runCandidate.candidate_id,
    );
    if (!runPolicy) throw new Error('missing Run-origin reconciliation policy');
    runPolicy.disposition = 'potential_conflict';
    runPolicy.promotion_eligibility = 'suppressed';
    writeFileSync(runReceiptPath, `${JSON.stringify(runReceipt, null, 2)}\n`, 'utf8');

    const sessionReceipt = JSON.parse(readFileSync(
      sessionReconciliationPath(store, 's-origin-policy'),
      'utf8',
    )) as { candidates: Array<{ candidate_id: string; promotion_eligibility: string }> };
    expect(sessionReceipt.candidates.find(
      candidate => candidate.candidate_id === runCandidate.candidate_id,
    )?.promotion_eligibility).toBe('eligible');
    expect(() => promoteSessionKnowledge(root, 's-origin-policy', {
      candidateIds: [runCandidate.candidate_id],
    })).toThrow(/suppressed/);

    runPolicy.disposition = 'supersede_candidate';
    runPolicy.promotion_eligibility = 'eligible';
    Object.assign(runPolicy, {
      canonical_id: 'knowhow-tip-20260816-target-a',
      resolution: {
        status: 'confirmed', reason: 'Run origin target', resolved_at: '2026-08-16T03:00:00.000Z',
      },
    });
    writeFileSync(runReceiptPath, `${JSON.stringify(runReceipt, null, 2)}\n`, 'utf8');
    const sessionPolicy = sessionReceipt.candidates.find(
      candidate => candidate.candidate_id === runCandidate.candidate_id,
    ) as Record<string, unknown> | undefined;
    if (!sessionPolicy) throw new Error('missing Session-origin reconciliation policy');
    sessionPolicy.disposition = 'supersede_candidate';
    sessionPolicy.promotion_eligibility = 'eligible';
    sessionPolicy.canonical_id = 'knowhow-tip-20260816-target-b';
    sessionPolicy.resolution = {
      status: 'confirmed', reason: 'Session origin target', resolved_at: '2026-08-16T03:00:00.000Z',
    };
    writeFileSync(
      sessionReconciliationPath(store, 's-origin-policy'),
      `${JSON.stringify(sessionReceipt, null, 2)}\n`,
      'utf8',
    );
    expect(() => promoteSessionKnowledge(root, 's-origin-policy', {
      candidateIds: [runCandidate.candidate_id],
    })).toThrow(/conflicting confirmed supersession targets/);
  });

  it('commits v3 spec supersession and promotion ledger changes in one transaction', async () => {
    const { root, store } = setup('s-spec-supersede', 'run-spec-supersede');
    const specDir = join(root, '.workflow', 'specs');
    mkdirSync(specDir, { recursive: true });
    const oldPath = join(specDir, 'existing-rule.md');
    writeFileSync(oldPath, [
      '# Existing rule',
      '',
      '<spec-entry category="arch" sid="S-existing-rule" title="Shared rule">',
      'Old rule content.',
      '</spec-entry>',
      '',
    ].join('\n'), 'utf8');
    const staged = stageRunKnowledgeCandidate(root, 'run-spec-supersede', {
      target: 'spec',
      title: 'Shared rule',
      content: 'Replacement rule content.',
      category: 'arch',
    }, 's-spec-supersede');
    sealFixtureRun(store, 's-spec-supersede', 'run-spec-supersede');
    await invokeKnowledge(root, 'review', 's-spec-supersede', '--refresh', '--json');

    const result = await invokeKnowledge(
      root,
      'promote', 's-spec-supersede', '--resolve', staged.candidate_id,
      '--as', 'supersede', '--target', 'S-existing-rule',
      '--reason', 'The replacement is the reviewed canonical rule', '--json',
    ) as { promoted: Array<{ promoted_id: string }> };
    const promotedId = result.promoted[0].promoted_id;
    expect(readFileSync(oldPath, 'utf8')).toContain(
      `sid="S-existing-rule" title="Shared rule" status="deprecated" superseded-by="${promotedId}"`,
    );
    const corpus = readdirSync(specDir)
      .filter(filename => filename.endsWith('.md'))
      .map(filename => readFileSync(join(specDir, filename), 'utf8'))
      .join('\n');
    expect(corpus).toContain(`sid="${promotedId}"`);
    expect(corpus).toContain(`supersedes="S-existing-rule"`);
    expect(readRunKnowledgeDelta(store, 's-spec-supersede', 'run-spec-supersede', true).candidates[0])
      .toMatchObject({ status: 'promoted', promoted_id: promotedId });
  });

  it('commits v3 knowhow supersession and promotion ledger changes in one transaction', async () => {
    const { root, store } = setup('s-knowhow-supersede', 'run-knowhow-supersede');
    const knowhowDir = join(root, '.workflow', 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    const oldPath = join(knowhowDir, 'TIP-20260816-existing-recipe.md');
    const oldId = 'knowhow-tip-20260816-existing-recipe';
    writeFileSync(oldPath, [
      '---',
      'title: Shared recipe',
      'type: tip',
      'explicitId: tip-20260816-existing-recipe',
      'status: active',
      '---',
      '',
      'Old recipe content.',
      '',
    ].join('\n'), 'utf8');
    const staged = stageRunKnowledgeCandidate(root, 'run-knowhow-supersede', {
      target: 'knowhow',
      title: 'Shared recipe',
      content: 'Replacement recipe content.',
    }, 's-knowhow-supersede');
    sealFixtureRun(store, 's-knowhow-supersede', 'run-knowhow-supersede');
    await invokeKnowledge(root, 'review', 's-knowhow-supersede', '--refresh', '--json');

    const result = await invokeKnowledge(
      root,
      'promote', 's-knowhow-supersede', '--resolve', staged.candidate_id,
      '--as', 'supersede', '--target', oldId,
      '--reason', 'The replacement is the reviewed canonical recipe', '--json',
    ) as { promoted: Array<{ promoted_id: string }> };
    const promotedId = result.promoted[0].promoted_id;
    const oldDocument = readFileSync(oldPath, 'utf8');
    expect(oldDocument).toContain('status: "deprecated"');
    expect(oldDocument).toContain(`supersededBy: "${promotedId}"`);
    const newDocument = readdirSync(knowhowDir)
      .filter(filename => filename.endsWith('.md') && filename !== 'TIP-20260816-existing-recipe.md')
      .map(filename => readFileSync(join(knowhowDir, filename), 'utf8'))
      .find(document => document.includes('Replacement recipe content.'));
    expect(newDocument).toContain(`supersedes: ["${oldId}"]`);
    expect(readRunKnowledgeDelta(store, 's-knowhow-supersede', 'run-knowhow-supersede', true).candidates[0])
      .toMatchObject({ status: 'promoted', promoted_id: promotedId });
  });

  it('rejects promotion recovery after the corpus fingerprint changes', async () => {
    const { root, store } = setup('s-recovery-fingerprint', 'run-recovery-fingerprint');
    const staged = stageRunKnowledgeCandidate(root, 'run-recovery-fingerprint', {
      target: 'knowhow',
      title: 'Recovery fingerprint',
      content: 'Recovery must validate the current knowledge corpus fingerprint',
    }, 's-recovery-fingerprint');
    sealFixtureRun(store, 's-recovery-fingerprint', 'run-recovery-fingerprint');
    await invokeKnowledge(root, 'review', 's-recovery-fingerprint', '--refresh', '--json');

    const deltaPath = runKnowledgeDeltaPath(store, 's-recovery-fingerprint', 'run-recovery-fingerprint');
    const delta = readRunKnowledgeDelta(store, 's-recovery-fingerprint', 'run-recovery-fingerprint', true);
    const candidate = delta.candidates.find(item => item.candidate_id === staged.candidate_id);
    if (!candidate) throw new Error('missing recovery candidate');
    candidate.status = 'promoting';
    candidate.promoted_id = 'tip-20260816-recovery-fingerprint';
    writeFileSync(deltaPath, `${JSON.stringify(delta, null, 2)}\n`, 'utf8');
    mkdirSync(join(root, '.workflow', 'knowhow'), { recursive: true });
    writeFileSync(
      join(root, '.workflow', 'knowhow', 'concurrent-corpus-change.md'),
      [
        '---',
        'title: Concurrent corpus change',
        'type: tip',
        'status: active',
        '---',
        '',
        'Unrelated corpus content.',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(() => promoteSessionKnowledge(root, 's-recovery-fingerprint', {
      candidateIds: [staged.candidate_id],
    })).toThrow(/stale reconciliation|corpus fingerprint|candidate fingerprint changed/i);
  });

  it('fails completion closed on unreconcilable candidate frontmatter without sealing authority', () => {
    const { store } = setup('s-fail-closed', 'run-fail-closed');
    writeFileSync(
      join(store.runDir('s-fail-closed', 'run-fail-closed'), 'report.md'),
      candidateReport('Candidate must not be dropped'),
      'utf8',
    );
    writeFileSync(
      join(store.runDir('s-fail-closed', 'run-fail-closed'), 'knowledge-delta.json'),
      '{not valid JSON',
      'utf8',
    );

    expect(() => completeRunAndAdvance(store, {
      ...completionIdentity('s-fail-closed', 'req-fail-closed'),
      runId: 'run-fail-closed',
      expectedRunRevision: 0,
      expectedOrchestrationRevision: 0,
      verdict: 'done',
      knowledgeReconciliation: null,
    })).toThrow(/candidate-bearing report frontmatter that cannot be reconciled/);
    expect(store.readRunV30('s-fail-closed', 'run-fail-closed').status).toBe('running');
    expect(store.readSessionV30('s-fail-closed').orchestration_revision).toBe(0);
    expect(existsSync(join(store.runDir('s-fail-closed', 'run-fail-closed'), 'knowledge-reconciliation.json')))
      .toBe(false);
  });
});
