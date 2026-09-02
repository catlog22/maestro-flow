import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  completeExecutionRun,
  completeRun,
  createExecutionRun,
  createRun,
  briefRun,
  checkRun,
  prepareStep,
  resolveArgumentRequirements,
  resolveTopicSessionId,
} from './runtime.js';
import { sealExecution, startExecution } from './execution.js';
import type { ExecutionLeaseClaim } from './lease.js';
import { runNextStep } from './next.js';
import { SessionStore } from './store.js';
import { createTopicIdentity } from './topic-identity.js';
import { archiveSession } from './session-transition.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-runtime-topic-'));

  v2Workspace(value);
  roots.push(value);
  return value;
}

function enableV20(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
  writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/2.0',
      features: { session_statusless: true },
    },
  }));
}

function commandFile(projectRoot: string, name: string, contract: string, argumentHint?: string): void {
  const dir = join(projectRoot, '.claude', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `${argumentHint ? `---\nname: ${name}\nargument-hint: "${argumentHint}"\nsession-mode: run\n---\n` : ''}<contract>\n${contract}\n</contract>\n# ${name}\n`, 'utf8');
}

const producerContract = `contract_version: 2.1
arguments: []
consumes: []
produces:
  - kind: context
    path: outputs/context.json
    alias: current-context
    role: primary
    required: true
    schema: context/1.0
gates:
  entry: []
  exit: []`;

const consumerContract = `contract_version: 2.1
arguments: []
consumes:
  - kind: context
    alias: current-context
    required: true
    require_status: sealed
    schema: context/1.0
    role: primary
produces: []
gates:
  entry: []
  exit: []`;

function executionClaim(started: ReturnType<typeof startExecution>): ExecutionLeaseClaim {
  return {
    ownerId: started.lease_claim.owner_id,
    ownerKind: started.lease_claim.owner_kind,
    epoch: started.lease_claim.epoch,
    leaseId: started.lease_claim.lease_id,
  };
}

function readyReport(store: SessionStore, sessionId: string, runId: string): void {
  writeFileSync(join(store.runDir(sessionId, runId), 'report.md'), [
    '---', 'verdict: ready', 'summary: complete', 'constraints: []',
    'decisions: []', 'concerns: []', 'next: []', '---', '',
  ].join('\n'));
}

function sealContext(projectRoot: string, sessionId: string, runId: string, value: string): void {
  const outputs = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId, 'outputs');
  writeFileSync(join(outputs, 'context.json'), JSON.stringify({
    _meta: { kind: 'context', schema: 'context/1.0', role: 'primary', alias: 'current-context' },
    value,
  }));
  expect(completeRun(projectRoot, runId, sessionId).sealed).toBe(true);
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('topic Session resolution', () => {
  it('reuses one Unicode topic across different commands and persists command-independent identity', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'topic-plan-x', 'contract_version: 2.1\narguments: []\nconsumes: []\nproduces: []\ngates: { entry: [], exit: [] }');
    commandFile(projectRoot, 'topic-execute-x', 'contract_version: 2.1\narguments: []\nconsumes: []\nproduces: []\ngates: { entry: [], exit: [] }');
    const first = createRun({ projectRoot, command: 'topic-plan-x', intent: '制定方案', topic: '  ＡＰＩ\u3000迁移 😀 ' });
    const completed = completeRun(projectRoot, first.run_id, first.session_id);
    expect(completed.sealed, JSON.stringify(completed)).toBe(true);
    const second = createRun({ projectRoot, command: 'topic-execute-x', intent: '执行方案', topic: 'api 迁移 😀' });
    expect(second.session_id).toBe(first.session_id);
    expect(new SessionStore(projectRoot).readBundle(first.session_id).session.topic_identity).toMatchObject({
      normalized: 'api 迁移 😀',
      source: 'explicit',
    });
  });

  it('fails closed for ambiguous running topic matches and never auto-selects paused', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'demo', 'contract_version: 2.1\narguments: []\nconsumes: []\nproduces: []\ngates: { entry: [], exit: [] }');
    const store = new SessionStore(projectRoot);
    for (const id of ['a', 'b']) {
      store.createSession(id, 'legacy');
      store.update(id, draft => { draft.session.topic_identity = createTopicIdentity(projectRoot, '共享主题'); });
    }
    expect(() => createRun({ projectRoot, command: 'demo', topic: '共享主题' })).toThrow(/ambiguous/);
    store.update('a', draft => { draft.session.status = 'paused'; });
    store.update('b', draft => { draft.session.status = 'paused'; });
    const created = createRun({ projectRoot, command: 'demo', topic: '共享主题' });
    expect(created.session_id).not.toBe('a');
    expect(created.session_id).not.toBe('b');
  });

  it('excludes archived statusless identities from automatic topic matching while retaining exact reads', () => {
    const projectRoot = root();
    enableV20(projectRoot);
    const store = new SessionStore(projectRoot);
    store.createSession('history', 'shared statusless topic');
    expect(resolveTopicSessionId(projectRoot, 'shared statusless topic')).toBe('history');

    archiveSession(projectRoot, 'history', {
      requestId: 'archive-topic', actor: 'operator', reason: 'historical',
      evidence: ['evidence/archive.json'], expectedIdentityRevision: 1, expectedActivityRevision: 0,
      now: new Date('2026-08-05T00:00:00.000Z'),
    });
    expect(resolveTopicSessionId(projectRoot, 'shared statusless topic')).toBeNull();
    expect(resolveTopicSessionId(projectRoot, 'shared statusless topic', 'history')).toBe('history');
  });

  it('never allocates a second Run into a Session that already has an active Run', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'demo', 'contract_version: 2.1\narguments: []\nconsumes: []\nproduces: []\ngates: { entry: [], exit: [] }');
    const first = createRun({ projectRoot, command: 'demo', topic: 'singleton' });
    expect(() => createRun({ projectRoot, command: 'demo', sessionId: first.session_id })).toThrow(/already has active Run.*run brief/s);
    expect(() => createRun({ projectRoot, command: 'demo', topic: 'singleton' })).toThrow(/already has active Run.*run brief/s);
    const runs = readdirSync(join(projectRoot, '.workflow', 'sessions', first.session_id, 'runs'));
    expect(runs).toEqual([first.run_id]);
  });
});

describe('same-Session reuse assessment', () => {
  it('persists receipt-backed 1.1 through production prepare/create and revalidates it at complete', () => {
    const projectRoot = root();
    enableV20(projectRoot);
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume', consumerContract);
    const store = new SessionStore(projectRoot);
    store.createSession('s', 'receipt-backed reuse', { command: 'produce' });

    const first = startExecution(projectRoot, 's', {
      requestId: 'reuse-start-1', ownerId: 'producer', ownerKind: 'codex',
    });
    const producer = createExecutionRun({
      projectRoot, command: 'produce', sessionId: 's', intent: 'receipt-backed reuse',
      executionId: first.execution.execution_id, generation: first.execution.generation,
      expectedExecutionRevision: 1, executionLease: executionClaim(first), requestId: 'reuse-create-1',
    });
    writeFileSync(join(store.runDir('s', producer.run_id), 'outputs', 'context.json'), JSON.stringify({
      _meta: { kind: 'context', schema: 'context/1.0', role: 'primary', alias: 'current-context' },
      value: 'sealed authority',
    }));
    readyReport(store, 's', producer.run_id);
    expect(completeExecutionRun(projectRoot, producer.run_id, {
      sessionId: 's', executionId: first.execution.execution_id, generation: first.execution.generation,
      expectedExecutionRevision: 2, executionLease: executionClaim(first), requestId: 'reuse-complete-1',
    }).sealed).toBe(true);
    sealExecution(projectRoot, {
      sessionId: 's', executionId: first.execution.execution_id, requestId: 'reuse-seal-1',
      expectedExecutionRevision: 3, lease: executionClaim(first), summary: 'producer sealed', outcome: 'done',
    });

    const second = startExecution(projectRoot, 's', {
      requestId: 'reuse-start-2', ownerId: 'consumer', ownerKind: 'codex',
    });
    const prepared = prepareStep(projectRoot, 'consume', undefined, 's');
    expect(prepared.previous?.reuse_assessments[0]).toMatchObject({
      schema_version: 'reuse-assessment/1.1',
      source_fence: {
        schema_version: 'reuse-source-fence/1.1',
        execution_seal_receipt: { execution_id: first.execution.execution_id, generation: 1 },
      },
    });
    const consumer = createExecutionRun({
      projectRoot, command: 'consume', sessionId: 's', intent: 'receipt-backed reuse',
      executionId: second.execution.execution_id, generation: second.execution.generation,
      expectedExecutionRevision: 1, executionLease: executionClaim(second), requestId: 'reuse-create-2',
    });
    expect(consumer.upstream['current-context']).toBeDefined();
    const persisted = store.readExecutionRun('s', consumer.run_id);
    expect(persisted).toMatchObject({
      schema_version: 'command-run/1.4',
      input: { reuse_assessments: [{ schema_version: 'reuse-assessment/1.1' }] },
    });
    readyReport(store, 's', consumer.run_id);
    expect(briefRun(projectRoot, consumer.run_id, 's')).toMatchObject({
      schema_version: 'brief-result/1.2',
      execution_contract: {
        schema_version: 'execution-contract/1.2',
        reuse_assessments: [{ schema_version: 'reuse-assessment/1.1' }],
      },
    });
    expect(completeExecutionRun(projectRoot, consumer.run_id, {
      sessionId: 's', executionId: second.execution.execution_id, generation: second.execution.generation,
      expectedExecutionRevision: 2, executionLease: executionClaim(second), requestId: 'reuse-complete-2',
    })).toMatchObject({ sealed: true, errors: [] });
    sealExecution(projectRoot, {
      sessionId: 's', executionId: second.execution.execution_id, requestId: 'reuse-seal-2',
      expectedExecutionRevision: 3, lease: executionClaim(second), summary: 'consumer sealed', outcome: 'done',
    });

    const third = startExecution(projectRoot, 's', {
      requestId: 'reuse-start-3', ownerId: 'consumer-2', ownerKind: 'codex',
    });
    const drifted = createExecutionRun({
      projectRoot, command: 'consume', sessionId: 's', intent: 'receipt-backed reuse',
      executionId: third.execution.execution_id, generation: third.execution.generation,
      expectedExecutionRevision: 1, executionLease: executionClaim(third), requestId: 'reuse-create-3',
    });
    readyReport(store, 's', drifted.run_id);
    const artifact = Object.values(store.readBundle('s').artifacts.artifacts)
      .find(item => item.producer_run_id === producer.run_id)!;
    writeFileSync(join(store.sessionDir('s'), artifact.relative_path), '{"tampered":true}');
    const rejected = completeExecutionRun(projectRoot, drifted.run_id, {
      sessionId: 's', executionId: third.execution.execution_id, generation: third.execution.generation,
      expectedExecutionRevision: 2, executionLease: executionClaim(third), requestId: 'reuse-complete-3',
    });
    expect(rejected.sealed).toBe(false);
    expect(rejected.errors.some(error => /reuse fence|artifact|content hash/i.test(error))).toBe(true);
  }, 60_000);

  it('binds only REUSE and exposes the same assessment provenance in brief', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume', consumerContract);
    const producer = createRun({ projectRoot, command: 'produce', topic: 'reuse' });
    sealContext(projectRoot, producer.session_id, producer.run_id, 'stable');
    const consumer = createRun({ projectRoot, command: 'consume', sessionId: producer.session_id, topic: 'reuse' });
    expect(consumer.upstream['current-context']).toBeDefined();
    expect(consumer.reuse_assessments).toEqual([
      expect.objectContaining({ decision: 'REUSE', consumer: expect.objectContaining({ schema: 'context/1.0', role: 'primary' }) }),
    ]);
    const brief = briefRun(projectRoot, consumer.run_id, consumer.session_id);
    expect(brief.execution_contract.reuse_assessments).toEqual(consumer.reuse_assessments);
  });

  it('keeps topic backfill fresh, rejects alias mismatch, and revalidates pinned bytes', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume-v2', consumerContract.replace('context/1.0', 'context/2.0'));
    commandFile(projectRoot, 'consume', consumerContract);
    commandFile(projectRoot, 'consume-other-alias', consumerContract
      .replaceAll('current-context', 'other-context')
      .replace('    required: true', '    required: false'));
    const first = createRun({ projectRoot, command: 'produce', topic: 'reuse guards' });
    sealContext(projectRoot, first.session_id, first.run_id, 'one');

    const schema = createRun({ projectRoot, command: 'consume-v2', sessionId: first.session_id, topic: 'reuse guards' });
    expect(schema.upstream).toEqual({});
    expect(schema.reuse_assessments[0]).toMatchObject({ decision: 'REJECT', reason_codes: expect.arrayContaining(['ARTIFACT_SCHEMA_MISMATCH']) });
    const rejectedRequired = completeRun(projectRoot, schema.run_id, schema.session_id);
    expect(rejectedRequired.sealed).toBe(false);
    expect(rejectedRequired.gates.blocking.length).toBeGreaterThan(0);

    const guardRoot = root();
    commandFile(guardRoot, 'produce', producerContract);
    commandFile(guardRoot, 'consume', consumerContract);
    commandFile(guardRoot, 'consume-other-alias', consumerContract
      .replaceAll('current-context', 'other-context')
      .replace('    required: true', '    required: false'));
    const guardFirst = createRun({ projectRoot: guardRoot, command: 'produce', topic: 'reuse guards' });
    sealContext(guardRoot, guardFirst.session_id, guardFirst.run_id, 'one');
    const store = new SessionStore(guardRoot);
    store.update(guardFirst.session_id, draft => { draft.session.identity_revision++; });
    const fresh = createRun({ projectRoot: guardRoot, command: 'consume', sessionId: guardFirst.session_id, topic: 'reuse guards' });
    expect(fresh.upstream['current-context']).toBeDefined();
    expect(fresh.reuse_assessments[0]).toMatchObject({ decision: 'REUSE' });
    expect(completeRun(guardRoot, fresh.run_id, fresh.session_id).sealed).toBe(true);

    const aliasMismatch = createRun({ projectRoot: guardRoot, command: 'consume-other-alias', sessionId: guardFirst.session_id, topic: 'reuse guards' });
    expect(aliasMismatch.upstream).toEqual({});
    expect(aliasMismatch.reuse_assessments).toEqual([]);
    expect(completeRun(guardRoot, aliasMismatch.run_id, aliasMismatch.session_id).sealed).toBe(true);

    const fenced = createRun({ projectRoot: guardRoot, command: 'consume', sessionId: guardFirst.session_id, topic: 'reuse guards' });
    expect(fenced.upstream['current-context']).toBeDefined();

    const artifact = Object.values(store.readBundle(guardFirst.session_id).artifacts.artifacts)[0];
    writeFileSync(join(store.sessionDir(guardFirst.session_id), artifact.relative_path), '{"tampered":true}');
    const brief = briefRun(guardRoot, fenced.run_id, fenced.session_id);
    expect(brief.execution_contract.inputs.every(input => input.resolved === null)).toBe(true);
    expect(brief.execution_contract.reuse_assessments[0]).toMatchObject({ decision: 'REJECT', reason_codes: expect.arrayContaining(['ARTIFACT_HASH_MISMATCH']) });
    expect(checkRun(guardRoot, fenced.run_id, fenced.session_id).errors).toEqual(expect.arrayContaining([expect.stringContaining('reuse fence')]));
    expect(completeRun(guardRoot, fenced.run_id, fenced.session_id).sealed).toBe(false);
  });

  it('records alias lineage and reports conflict only for multiple unsequenced current candidates', () => {
    const conflictRoot = root();
    commandFile(conflictRoot, 'produce', producerContract);
    commandFile(conflictRoot, 'consume', consumerContract);
    commandFile(conflictRoot, 'consume-no-alias', consumerContract.replace('    alias: current-context\n', ''));
    const left = createRun({ projectRoot: conflictRoot, command: 'produce', topic: 'conflict' });
    sealContext(conflictRoot, left.session_id, left.run_id, 'left');
    const right = createRun({ projectRoot: conflictRoot, command: 'produce', sessionId: left.session_id, topic: 'conflict' });
    sealContext(conflictRoot, right.session_id, right.run_id, 'right');

    const store = new SessionStore(conflictRoot);
    const registered = store.readBundle(left.session_id).artifacts;
    const currentId = registered.aliases['current-context'];
    const current = registered.artifacts[currentId];
    const previousId = current.replaces!;
    expect(current.replaces).toBe(previousId);
    expect(registered.artifacts[previousId].status).toBe('superseded');

    const lineageConsumer = createRun({ projectRoot: conflictRoot, command: 'consume', sessionId: left.session_id, topic: 'conflict' });
    expect(lineageConsumer.upstream['current-context']?.artifact_id).toBe(currentId);
    expect(lineageConsumer.reuse_assessments).toEqual([expect.objectContaining({ decision: 'REUSE' })]);
    expect(completeRun(conflictRoot, lineageConsumer.run_id, lineageConsumer.session_id).sealed).toBe(true);

    store.update(left.session_id, draft => {
      draft.artifacts.artifacts[previousId].status = 'sealed';
      draft.artifacts.artifacts[currentId].replaces = null;
      delete draft.artifacts.aliases['current-context'];
      draft.artifacts.revision++;
    });
    const conflict = createRun({ projectRoot: conflictRoot, command: 'consume-no-alias', sessionId: left.session_id, topic: 'conflict' });
    expect(conflict.upstream).toEqual({});
    expect(conflict.reuse_assessments.every(item => item.decision === 'CONFLICT')).toBe(true);
  });

  it('binds the previous sealed generation when a command consumes and produces the same alias', () => {
    const selfReuseContract = `contract_version: 2.1
arguments: []
consumes:
  - kind: context
    alias: current-context
    required: false
    require_status: sealed
    schema: context/1.0
    role: primary
produces:
  - kind: context
    path: outputs/context.json
    alias: current-context
    role: primary
    required: true
    schema: context/1.0
gates:
  entry: []
  exit: []`;
    const projectRoot = root();
    commandFile(projectRoot, 'self-reuse', selfReuseContract);

    const first = createRun({ projectRoot, command: 'self-reuse', sessionId: 's', intent: 'self' });
    expect(first.upstream).toEqual({});
    expect(first.reuse_warnings).toEqual([]);
    sealContext(projectRoot, 's', first.run_id, 'gen-1');

    const store = new SessionStore(projectRoot);
    const gen1Id = Object.entries(store.readBundle('s').artifacts.artifacts)
      .find(([, artifact]) => artifact.producer_run_id === first.run_id)?.[0]!;
    const second = createRun({ projectRoot, command: 'self-reuse', sessionId: 's', intent: 'self' });
    expect(second.upstream['current-context']?.artifact_id).toBe(gen1Id);
    expect(second.reuse_assessments).toEqual([expect.objectContaining({ decision: 'REUSE' })]);
    sealContext(projectRoot, 's', second.run_id, 'gen-2');

    const gen2Id = Object.entries(store.readBundle('s').artifacts.artifacts)
      .find(([, artifact]) => artifact.producer_run_id === second.run_id)?.[0]!;
    const third = createRun({ projectRoot, command: 'self-reuse', sessionId: 's', intent: 'self' });
    expect(third.upstream['current-context']?.artifact_id).toBe(gen2Id);
    expect(third.reuse_assessments[0]).toMatchObject({ decision: 'REUSE' });
  });

  it('binds a producer through an explicit schema_range major-compatible consume', () => {
    const rangeConsumer = `contract_version: 2.1
arguments: []
consumes:
  - kind: context
    alias: current-context
    required: true
    require_status: sealed
    schema_range: context/1.x
    role: primary
produces: []
gates:
  entry: []
  exit: []`;
    const projectRoot = root();
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume-range', rangeConsumer);
    const producer = createRun({ projectRoot, command: 'produce', sessionId: 's', intent: 'range' });
    sealContext(projectRoot, 's', producer.run_id, 'v');

    const consumer = createRun({ projectRoot, command: 'consume-range', sessionId: 's', intent: 'range' });
    expect(consumer.upstream['current-context']).toBeDefined();
    expect(consumer.reuse_assessments[0]).toMatchObject({
      decision: 'REUSE',
      reason_codes: expect.arrayContaining(['ARTIFACT_SCHEMA_MAJOR_COMPATIBLE']),
    });
    expect(consumer.entry_gates.blocking).toEqual([]);
  });

  it('warns when a consume alias has same-kind artifacts but no registered alias', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume-other', consumerContract.replace('alias: current-context', 'alias: other-context'));
    const producer = createRun({ projectRoot, command: 'produce', sessionId: 's', intent: 'warn' });
    sealContext(projectRoot, 's', producer.run_id, 'v');

    const consumer = createRun({ projectRoot, command: 'consume-other', sessionId: 's', intent: 'warn' });
    expect(consumer.upstream).toEqual({});
    expect(consumer.reuse_warnings.some(warning => warning.includes("'other-context'") && warning.includes('context artifact'))).toBe(true);
  });
});

describe('argument requirements projection', () => {
  it('derives actual, default and unresolved required values for next and brief', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'args-demo', `contract_version: 2.1
arguments:
  - name: target
    type: string
    required: true
    question: Which target should be processed?
  - name: --mode
    type: string
    required: false
    default: safe
consumes: []
produces: []
gates: { entry: [], exit: [] }`);
    mkdirSync(join(projectRoot, 'workflows'), { recursive: true });
    writeFileSync(join(projectRoot, 'workflows', 'args-demo.md'), '# Args workflow\n');
    const store = new SessionStore(projectRoot);
    store.createSession('args', 'argument topic');
    store.update('args', draft => {
      draft.session.orchestration.chain.push({
        step_id: 'step-001-args-demo', command: 'args-demo', status: 'pending', run_id: null,
        inserted_by: 'test', decision_ref: null,
      });
    });
    const missing = runNextStep(projectRoot, { sessionId: 'args' });
    expect(missing).toMatchObject({ exitCode: 1, reasonCode: 'ARGUMENT_REQUIRED', result: null });
    expect(missing.message).toContain('target: Which target should be processed?');
    expect(store.readBundle('args').session.orchestration.chain[0]).toMatchObject({ status: 'pending', run_id: null });
    expect(readdirSync(join(store.sessionDir('args'), 'runs'))).toEqual([]);

    const dispatched = runNextStep(projectRoot, { sessionId: 'args', args: ['chosen', '--mode=fast'] });
    expect(dispatched.exitCode, dispatched.message).toBe(0);
    expect(dispatched.result?.argument_requirements).toEqual([
      expect.objectContaining({ name: 'target', missing: false, source: 'actual-arg' }),
      expect.objectContaining({ name: '--mode', missing: false, source: 'actual-arg', default: 'safe' }),
    ]);
    const brief = briefRun(projectRoot, dispatched.result!.run_id, 'args');
    expect(brief.execution_contract.argument_requirements).toEqual(dispatched.result?.argument_requirements);

    const actualRoot = root();
    commandFile(actualRoot, 'args-demo', `contract_version: 2.1
arguments:
  - name: target
    type: string
    required: true
    question: Which target should be processed?
  - name: --mode
    type: string
    required: false
    default: safe
  - name: --dry-run
    type: boolean
    required: false
    default: false
consumes: []
produces: []
gates: { entry: [], exit: [] }`);
    expect(() => createRun({
      projectRoot: actualRoot,
      command: 'args-demo',
      intent: 'target supplied only as Session metadata',
      args: [],
    })).toThrow(
      /Missing required arguments: target \(Which target should be processed\?\).*--intent is Session metadata only.*--arg <value>.*-- <args\.\.\.>/s,
    );
    expect(existsSync(join(actualRoot, '.workflow', 'sessions'))).toBe(false);
    const actual = createRun({
      projectRoot: actualRoot,
      command: 'args-demo',
      intent: 'metadata-only goal',
      args: ['chosen', '--mode=fast'],
    });
    expect(actual.argument_requirements).toEqual([
      expect.objectContaining({ name: 'target', missing: false, source: 'actual-arg' }),
      expect.objectContaining({ name: '--mode', missing: false, source: 'actual-arg', default: 'safe' }),
      expect.objectContaining({ name: '--dry-run', missing: false, source: 'contract-default', default: false }),
    ]);
    const actualStore = new SessionStore(actualRoot);
    expect(actualStore.readRun(actual.session_id, actual.run_id).input.args).toEqual(['chosen', '--mode=fast']);
    expect(actualStore.readBundle(actual.session_id).session.intent).toBe('metadata-only goal');

    const hintedRoot = root();
    commandFile(hintedRoot, 'hinted', 'consumes: []\nproduces: []\ngates: { entry: [], exit: [] }', '<target> [--dry-run]');
    expect(resolveArgumentRequirements(hintedRoot, 'hinted', [])).toEqual([
      expect.objectContaining({ name: 'target', required: true, missing: true, source: 'unresolved' }),
      expect.objectContaining({ name: '--dry-run', type: 'boolean', required: false, missing: false, source: 'unresolved' }),
    ]);
  });

  it('prepare exposes assessments and selected refs with their assessment hash', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'produce', producerContract);
    commandFile(projectRoot, 'consume', consumerContract);
    const producer = createRun({ projectRoot, command: 'produce', topic: 'prepare reuse' });
    sealContext(projectRoot, producer.session_id, producer.run_id, 'prepared');

    const prepared = prepareStep(projectRoot, 'consume', undefined, producer.session_id);
    expect(prepared.previous?.upstream['current-context']).toBeDefined();
    expect(prepared.previous?.reuse_assessments).toEqual([expect.objectContaining({ decision: 'REUSE' })]);
    expect(prepared.previous?.selected_refs).toEqual([
      expect.objectContaining({
        alias: 'current-context',
        artifact_id: expect.any(String),
        assessment_hash: prepared.previous?.reuse_assessments[0].assessment_hash,
      }),
    ]);
  });
});
