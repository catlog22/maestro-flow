import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerRunV3Command } from '../../commands/run-v3.js';
import { runResponseV12Schema } from '../protocol-schemas.js';
import type { RunV30, SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import {
  generateV3RunKnowledgeReconciliation,
  readV3KnowledgeReconciliation,
  reconcileV3RunKnowledge,
  V3KnowledgeReconciliationError,
  v3ReconciliationSummary,
} from './knowledge-v3.js';

const REPORT_WITH_DECISIONS = `---
verdict: ready
summary: knowledge fixture
constraints:
  - id: C1
    text: Preserve backward compatibility
    status: locked
decisions:
  - id: D1
    text: Use the canonical SessionStore
    status: accepted
concerns: []
next: []
---
Knowledge fixture.
`;

const RUN_REPORT_TEMPLATE = '---\nverdict: ready\nsummary: ""\nconstraints: []\ndecisions: []\nconcerns: []\nnext: []\ndetails: {}\n---\n## 摘要\n\n## 结论/Verdict\n\n## 讨论/复盘\n\n## 产物\n\n## 交接/Next\n';

const roots: string[] = [];
const originalExitCode = process.exitCode;

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-v3-knowledge-'));
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

function session(): SessionStateV30 {
  return {
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 knowledge', definition_of_done: 'tests pass',
    status: 'open', orchestration_revision: 0, activity_revision: 0,
    chain: [
      { step_id: 'step-1', command: 'implement', args: [], status: 'running', run_ids: ['r-1'], goal_ref: null, decision_refs: [] },
      { step_id: 'step-2', command: 'verify', args: [], status: 'pending', run_ids: ['r-2'], goal_ref: null, decision_refs: [] },
    ],
    decisions: [], active_run_ids: ['r-1', 'r-2'], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
}

function run(runId: string, stepId: string, status: RunV30['status'] = 'pending'): RunV30 {
  return {
    schema_version: 'run/3.0', run_id: runId, session_id: 's-1', step_id: stepId,
    parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'implement', args: [], goal: null,
    status, revision: 0, actor_id: 'actor-a', input_refs: [], output_refs: [],
    primary_artifact_id: null, verdict: null, summary: null, legacy_execution_generation: null,
    created_at: '2026-08-12T00:00:00.000Z', started_at: null, ended_at: null, sealed_at: null,
  };
}

function setup(): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30(session());
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  store.writeRunV30(run('r-1', 'step-1'));
  store.writeRunV30(run('r-2', 'step-2'));
  return store;
}

function transcriptOnlyDelta(): unknown {
  return {
    schema_version: 'run-knowledge-delta/1.0',
    session_id: 's-v3',
    run_id: 'run-1',
    revision: 0,
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
    inputs: [],
    candidates: [{
      candidate_id: 'KDC-0123456789abcdef',
      target: 'spec',
      action: 'propose',
      title: 'Always use RFC 2119 keywords',
      content: 'Always use RFC 2119 keywords in requirement statements',
      category: 'arch',
      source_kind: 'manual',
      evidence_refs: ['transcript:abc123'],
      occurrences: 1,
      first_recorded_at: '2026-08-12T00:00:00.000Z',
      last_recorded_at: '2026-08-12T00:00:00.000Z',
      status: 'pending',
      promoted_id: null,
    }],
  };
}

/** session/3.0 CLI fixture with an existing Run (run-1) whose runDir is writable. */
function cliFixture(input: {
  runStatus?: RunV30['status'];
  report?: string | null;
  delta?: unknown;
} = {}): string {
  const value = root();
  const sessionDir = join(value, '.workflow', 'sessions', 's-v3');
  const runDir = join(sessionDir, 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(sessionDir, 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  const session: SessionStateV30 = {
    schema_version: 'session/3.0', session_id: 's-v3', objective: 'exercise run check',
    definition_of_done: 'reconciliation attached', status: 'open',
    orchestration_revision: 0, activity_revision: 0,
    chain: [{ step_id: 'step-1', command: 'implement', args: [], status: 'pending', run_ids: ['run-1'], goal_ref: null, decision_refs: [] }],
    decisions: [], active_run_ids: ['run-1'], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  const runDoc: RunV30 = {
    schema_version: 'run/3.0', run_id: 'run-1', session_id: 's-v3', step_id: 'step-1',
    parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'implement', args: [], goal: null,
    status: input.runStatus ?? 'pending', revision: input.runStatus === 'sealed' ? 2 : 0,
    actor_id: 'actor', input_refs: [], output_refs: [],
    primary_artifact_id: null, verdict: input.runStatus === 'sealed' ? 'done' : null,
    summary: input.runStatus === 'sealed' ? 'done' : null,
    created_at: '2026-08-12T00:00:00.000Z',
    started_at: input.runStatus === 'sealed' ? '2026-08-12T00:01:00.000Z' : null,
    ended_at: input.runStatus === 'sealed' ? '2026-08-12T00:02:00.000Z' : null,
    sealed_at: input.runStatus === 'sealed' ? '2026-08-12T00:02:00.000Z' : null,
  };
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(runDoc, null, 2)}\n`);
  if (input.report !== null) {
    writeFileSync(join(runDir, 'report.md'), input.report ?? RUN_REPORT_TEMPLATE, 'utf8');
  }
  if (input.delta !== undefined) {
    writeFileSync(join(runDir, 'knowledge-delta.json'), `${JSON.stringify(input.delta, null, 2)}\n`, 'utf8');
  }
  return value;
}

async function invoke(register: (program: Command) => void, args: string[]) {
  const writes: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const program = new Command().name('maestro').exitOverride();
  register(program);
  await program.parseAsync(['node', 'maestro', ...args]);
  expect(writes).toHaveLength(1);
  expect(writes[0].trim().split(/\r?\n/)).toHaveLength(1);
  return runResponseV12Schema.parse(JSON.parse(writes[0]));
}

function checkArgs(root: string): string[] {
  return ['run', 'check', 'run-1', '--session', 's-v3', '--json', '--workflow-root', root];
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('v3 knowledge reconciliation hook', () => {
  it('reconciles an open pending Run and writes a schema-valid receipt (empty corpus)', () => {
    const store = setup();
    const runDir = store.runDir('s-1', 'r-2');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'report.md'), REPORT_WITH_DECISIONS, 'utf8');
    const sessionBefore = readFileSync(join(store.sessionDir('s-1'), 'session.json'), 'utf8');
    const runBefore = readFileSync(join(runDir, 'run.json'), 'utf8');

    const receipt = reconcileV3RunKnowledge(store.projectRoot, 's-1', 'r-2');
    expect(receipt).not.toBeNull();
    expect(receipt!.session_id).toBe('s-1');
    expect(receipt!.run_id).toBe('r-2');
    expect(receipt!.schema_version).toBe('knowledge-reconciliation/1.0');
    expect(receipt!.counts.candidates).toBeGreaterThanOrEqual(0);
    expect(receipt!.counts).toMatchObject({
      candidates: 2,
      unique: 2,
      duplicates: 0,
      related: 0,
      conflicts: 0,
      review_required: 0,
      suppressed: 0,
    });

    const path = join(runDir, 'knowledge-reconciliation.json');
    expect(existsSync(path)).toBe(true);
    const reread = readV3KnowledgeReconciliation(store, 's-1', 'r-2');
    expect(reread).not.toBeNull();
    expect(reread!.counts).toEqual(receipt!.counts);
    expect(reread!.candidate_snapshot_hash).toBe(receipt!.candidate_snapshot_hash);
    expect(reread!.corpus_fingerprint).toBe(receipt!.corpus_fingerprint);

    // The reconcile is idempotent and never touches session/orchestration authority.
    const second = reconcileV3RunKnowledge(store.projectRoot, 's-1', 'r-2');
    expect(second).not.toBeNull();
    expect(second!.counts).toEqual(receipt!.counts);
    expect(second!.candidate_snapshot_hash).toBe(receipt!.candidate_snapshot_hash);
    expect(readFileSync(join(store.sessionDir('s-1'), 'session.json'), 'utf8')).toBe(sessionBefore);
    expect(readFileSync(join(runDir, 'run.json'), 'utf8')).toBe(runBefore);
  });

  it('returns null only when report.md is missing and throws on unreadable frontmatter', () => {
    const root = cliFixture({ report: null });
    expect(generateV3RunKnowledgeReconciliation(root, 's-v3', 'run-1')).toBeNull();

    const runDir = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1');
    writeFileSync(join(runDir, 'report.md'), '---\nverdict: [unterminated\n---\n', 'utf8');
    expect(() => generateV3RunKnowledgeReconciliation(root, 's-v3', 'run-1'))
      .toThrow(V3KnowledgeReconciliationError);
  });

  it('run complete without candidates records concerns when reconciliation fails', async () => {
    const root = cliFixture({ report: RUN_REPORT_TEMPLATE });
    const runPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json');
    const runDoc = JSON.parse(readFileSync(runPath, 'utf8')) as RunV30;
    writeFileSync(runPath, `${JSON.stringify({
      ...runDoc, status: 'running', started_at: '2026-08-12T00:01:00.000Z',
    }, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-delta.json'),
      '{not valid JSON',
      'utf8',
    );

    const completed = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-1', '--summary', 'done', '--advance',
      '--expected-orchestration-revision', '0', '--expected-run-revision', '0',
      '--session', 's-v3', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-visible-fail', '--reason', 'visible fail test',
      '--json', '--workflow-root', root,
    ]);
    expect(completed).toMatchObject({ operation: 'complete', ok: true });
    const completedResult = completed.result as { concerns?: string[]; knowledge_reconciliation?: unknown };
    expect(completedResult.knowledge_reconciliation).toBeUndefined();
    expect(completedResult.concerns).toEqual([
      expect.stringMatching(/knowledge reconciliation failed:/),
    ]);
    expect(existsSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-reconciliation.json')))
      .toBe(false);
  });

  it('returns null for a missing or corrupted receipt and validates the JSON shape', () => {
    const store = setup();
    expect(readV3KnowledgeReconciliation(store, 's-1', 'r-2')).toBeNull();

    const runDir = store.runDir('s-1', 'r-2');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'knowledge-reconciliation.json'), '{not valid json', 'utf8');
    expect(readV3KnowledgeReconciliation(store, 's-1', 'r-2')).toBeNull();

    writeFileSync(join(runDir, 'knowledge-reconciliation.json'), `${JSON.stringify({ schema_version: 'wrong' })}\n`, 'utf8');
    expect(readV3KnowledgeReconciliation(store, 's-1', 'r-2')).toBeNull();
  });

  it('emits the v2-aligned summary shape with review_required counts', () => {
    const store = setup();
    const runDir = store.runDir('s-1', 'r-2');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'report.md'), REPORT_WITH_DECISIONS, 'utf8');
    const receipt = reconcileV3RunKnowledge(store.projectRoot, 's-1', 'r-2')!;
    const summary = v3ReconciliationSummary(receipt);
    expect(summary).toEqual({
      schema_version: 'knowledge-reconciliation-receipt/1.0',
      candidate_snapshot_hash: receipt.candidate_snapshot_hash,
      corpus_fingerprint: receipt.corpus_fingerprint,
      retrieval_mode: 'lexical-kg',
      candidates: receipt.counts.candidates,
      duplicates: receipt.counts.duplicates,
      conflicts: receipt.counts.conflicts,
      review_required: receipt.counts.review_required,
      suppressed: receipt.counts.suppressed,
      review_command: 'maestro knowledge review s-1',
    });
  });

  it('omits knowledge_reconciliation from run check and never writes a receipt on read', async () => {
    const root = cliFixture({ report: RUN_REPORT_TEMPLATE });
    const response = await invoke(registerRunV3Command, checkArgs(root));
    expect(response).toMatchObject({
      operation: 'check', ok: true,
      result: {
        run_id: 'run-1', status: 'pending', revision: 0,
        available_transitions: ['running', 'cancelled'],
      },
    });
    const result = response.result as Record<string, unknown>;
    // check is read-only: no reconciliation is run and no field is invented.
    expect(result.knowledge_reconciliation).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(existsSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-reconciliation.json'))).toBe(false);
  });

  it('run complete reconciles once and run check then attaches the persisted receipt without warnings', async () => {
    const root = cliFixture({ report: RUN_REPORT_TEMPLATE, delta: transcriptOnlyDelta() });
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const runPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json');
    const runDoc = JSON.parse(readFileSync(runPath, 'utf8')) as RunV30;
    writeFileSync(runPath, `${JSON.stringify({
      ...runDoc, status: 'running', started_at: '2026-08-12T00:01:00.000Z',
    }, null, 2)}\n`, 'utf8');

    const completed = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-1', '--summary', 'done', '--advance',
      '--expected-orchestration-revision', '0', '--expected-run-revision', '0',
      '--session', 's-v3', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-complete-knowledge', '--reason', 'complete test',
      '--json', '--workflow-root', root,
    ]);
    expect(completed).toMatchObject({ operation: 'complete', ok: true });
    const completedResult = completed.result as Record<string, unknown>;
    expect(completedResult.knowledge_reconciliation).toMatchObject({
      schema_version: 'knowledge-reconciliation-receipt/1.0',
      candidates: 1,
      review_required: 1,
    });

    // The complete mutation legitimately advances the Session; the one-shot
    // reconcile itself is a plain idempotent file write (re-run leaves the
    // session untouched — covered by the direct hook tests above).
    expect(JSON.parse(readFileSync(sessionPath, 'utf8'))).toMatchObject({
      orchestration_revision: 1,
      chain: [{ status: 'completed' }],
      active_run_ids: [],
    });
    const receiptPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-reconciliation.json');
    expect(existsSync(receiptPath)).toBe(true);

    const response = await invoke(registerRunV3Command, checkArgs(root));
    const result = response.result as Record<string, unknown>;
    expect(response).toMatchObject({ operation: 'check', ok: true, result: { run_id: 'run-1', status: 'sealed' } });
    expect(result.knowledge_reconciliation).toMatchObject({ candidates: 1, review_required: 1 });
    // check never re-derives warnings from the receipt.
    expect(result.warnings).toBeUndefined();
  });

  it('reads the persisted receipt on check for any Run status without reconciling again', async () => {
    const root = cliFixture({ report: RUN_REPORT_TEMPLATE, delta: transcriptOnlyDelta() });
    const receipt = reconcileV3RunKnowledge(root, 's-v3', 'run-1');
    expect(receipt).not.toBeNull();
    expect(receipt!.counts.review_required).toBe(1);
    const receiptPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-reconciliation.json');
    const generatedAtBefore = (JSON.parse(readFileSync(receiptPath, 'utf8')) as { generated_at: string }).generated_at;

    const response = await invoke(registerRunV3Command, checkArgs(root));
    const result = response.result as Record<string, unknown>;
    expect(response).toMatchObject({ operation: 'check', ok: true, result: { run_id: 'run-1', status: 'pending' } });
    expect(result.knowledge_reconciliation).toMatchObject({ review_required: 1, candidates: 1 });
    expect(result.warnings).toBeUndefined();
    const generatedAtAfter = (JSON.parse(readFileSync(receiptPath, 'utf8')) as { generated_at: string }).generated_at;
    expect(generatedAtAfter).toBe(generatedAtBefore);
  });

  it('stages frontmatter candidates into the knowledge delta atomically with the seal and exposes them to review/promote', async () => {
    const root = cliFixture({ report: REPORT_WITH_DECISIONS, delta: transcriptOnlyDelta() });
    const runPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json');
    const runDoc = JSON.parse(readFileSync(runPath, 'utf8')) as RunV30;
    writeFileSync(runPath, `${JSON.stringify({
      ...runDoc, status: 'running', started_at: '2026-08-12T00:01:00.000Z',
    }, null, 2)}\n`, 'utf8');

    const completed = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-1', '--summary', 'done', '--advance',
      '--expected-orchestration-revision', '0', '--expected-run-revision', '0',
      '--session', 's-v3', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-delta-stage', '--reason', 'delta stage test',
      '--json', '--workflow-root', root,
    ]);
    expect(completed).toMatchObject({ operation: 'complete', ok: true });

    // The staged delta lives at the canonical v2 path, so knowledge
    // review/promote (summarizeSessionKnowledge) can see v3 candidates.
    const deltaPath = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-delta.json');
    expect(existsSync(deltaPath)).toBe(true);
    const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as {
      candidates: Array<{ source_kind: string; status: string }>;
    };
    const kinds = delta.candidates.map(candidate => candidate.source_kind).sort();
    expect(kinds).toContain('constraint');
    expect(kinds).toContain('decision');
    expect(delta.candidates.length).toBe(3); // transcript fixture + constraint + decision
    expect(delta.candidates.every(candidate => candidate.status === 'pending')).toBe(true);

    // Promote/review visibility: summarizeSessionKnowledge aggregates v3 deltas.
    const { summarizeSessionKnowledge } = await import('../knowledge.js');
    const summary = summarizeSessionKnowledge(root, 's-v3', { readOnly: true, strict: true });
    const v3Candidates = summary.candidates.filter(candidate => candidate.run_ids.includes('run-1'));
    expect(v3Candidates.length).toBe(3);
    expect(v3Candidates.every(candidate => candidate.status === 'pending')).toBe(true);
  });
});
