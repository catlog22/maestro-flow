import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerKnowledgeCommand } from './knowledge.js';
import { runUnifiedSearch } from './search.js';
import { startExecution } from '../run/execution.js';
import type { ExecutionLeaseClaim } from '../run/lease.js';
import {
  completeExecutionRun,
  completeRun,
  createExecutionRun,
  createRun,
  sealSession,
} from '../run/runtime.js';
import { readRunKnowledgeDelta, summarizeSessionKnowledge } from '../run/knowledge.js';
import type { RunV30, SessionStateV30 } from '../run/schemas.js';
import { SessionStore } from '../run/store.js';
import { initializeRepositoryIdentity } from '../repository/context.js';

vi.setConfig({ testTimeout: 60_000 });

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

let projectRoot: string;
let previousCwd: string;
let logs: string[];
let errors: string[];
const previousExecutionAuthorityFile = process.env.MAESTRO_EXECUTION_AUTHORITY_FILE;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'maestro-knowledge-cli-'));
  v2Workspace(projectRoot);
  previousCwd = process.cwd();
  process.chdir(projectRoot);
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
  vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
  process.exitCode = undefined;
  delete process.env.MAESTRO_EXECUTION_AUTHORITY_FILE;

  const commandDir = join(projectRoot, '.claude', 'commands');
  mkdirSync(commandDir, { recursive: true });
  writeFileSync(
    join(commandDir, 'knowledge-cli.md'),
    '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n',
    'utf8',
  );
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
  if (previousExecutionAuthorityFile === undefined) delete process.env.MAESTRO_EXECUTION_AUTHORITY_FILE;
  else process.env.MAESTRO_EXECUTION_AUTHORITY_FILE = previousExecutionAuthorityFile;
});

function program(): Command {
  const value = new Command();
  value.exitOverride();
  registerKnowledgeCommand(value);
  return value;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(['node', 'maestro', 'knowledge', ...args]);
}

function executionClaim(value: {
  owner_id: string;
  owner_kind: ExecutionLeaseClaim['ownerKind'];
  epoch: number;
  lease_id: string;
}): ExecutionLeaseClaim {
  return { ownerId: value.owner_id, ownerKind: value.owner_kind, epoch: value.epoch, leaseId: value.lease_id };
}

function createExecutionKnowledgeRun(sessionId: string) {
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, 'execution knowledge authority');
  const started = startExecution(projectRoot, sessionId, {
    requestId: `req-start-${sessionId}`,
    ownerId: `owner-${sessionId}`,
    ownerKind: 'pi',
  });
  const created = createExecutionRun({
    projectRoot,
    sessionId,
    command: 'knowledge-cli',
    executionId: started.execution.execution_id,
    generation: started.execution.generation,
    expectedExecutionRevision: started.execution.revision,
    executionLease: executionClaim(started.lease_claim),
    requestId: `req-run-${sessionId}`,
  });
  return {
    store,
    created,
    executionId: started.execution.execution_id,
    generation: started.execution.generation,
    revision: store.readExecution(sessionId, started.execution.execution_id).revision,
    claim: started.lease_claim,
  };
}

function createV3RunWithRetainedExecution(): { store: SessionStore; sessionId: string; runId: string } {
  const sessionId = 'v3-retained-execution';
  const runId = 'run-v3';
  writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }), 'utf8');
  const store = new SessionStore(projectRoot);
  const session: SessionStateV30 = {
    schema_version: 'session/3.0',
    session_id: sessionId,
    objective: 'v3 retained Execution knowledge test',
    definition_of_done: 'stage and record use Run v3 authority',
    status: 'open',
    orchestration_revision: 0,
    activity_revision: 0,
    chain: [{
      step_id: 'step-1', command: 'knowledge-cli', args: [], status: 'running', run_ids: [runId],
      goal_ref: null, decision_refs: [],
    }],
    decisions: [],
    active_run_ids: [runId],
    artifacts_ref: 'artifacts.json',
    evidence_ref: 'evidence.json',
    created_at: '2026-08-18T00:00:00.000Z',
    updated_at: '2026-08-18T00:00:00.000Z',
    completed_at: null,
    archived_at: null,
  };
  const run: RunV30 = {
    schema_version: 'run/3.0',
    run_id: runId,
    session_id: sessionId,
    step_id: 'step-1',
    parent_run_id: null,
    retry_of_run_id: null,
    attempt: 1,
    command: 'knowledge-cli',
    args: [],
    goal: null,
    status: 'running',
    revision: 0,
    actor_id: 'knowledge-test',
    input_refs: [],
    output_refs: [],
    primary_artifact_id: null,
    verdict: null,
    summary: null,
    legacy_execution_generation: null,
    created_at: '2026-08-18T00:00:00.000Z',
    started_at: '2026-08-18T00:00:01.000Z',
    ended_at: null,
    sealed_at: null,
  };
  store.writeSessionV30(session);
  store.writeRunV30(run);
  writeFileSync(join(store.sessionDir(sessionId), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`, 'utf8');
  const executionDir = join(store.sessionDir(sessionId), 'executions', 'execution-retained');
  mkdirSync(executionDir, { recursive: true });
  writeFileSync(join(executionDir, 'execution.json'), '{"retained":true}\n', 'utf8');
  return { store, sessionId, runId };
}

function executionAuthorityArgs(
  context: ReturnType<typeof createExecutionKnowledgeRun>,
  requestId: string,
  overrides: Partial<{ generation: number; revision: number; leaseId: string }> = {},
): string[] {
  return [
    '--execution', context.executionId,
    '--generation', String(overrides.generation ?? context.generation),
    '--request-id', requestId,
    '--expected-execution-revision', String(overrides.revision ?? context.revision),
    '--owner-id', context.claim.owner_id,
    '--owner-kind', context.claim.owner_kind,
    '--lease-epoch', String(context.claim.epoch),
    '--lease-id', overrides.leaseId ?? context.claim.lease_id,
  ];
}

describe('maestro knowledge Execution Run authority', () => {
  it('stages and records with exact authority, replays idempotently, and redacts the lease token', async () => {
    const context = createExecutionKnowledgeRun('knowledge-execution-success');
    const authorityPath = join(projectRoot, 'knowledge-authority.json');
    const writeAuthority = (requestId: string): void => writeFileSync(authorityPath, JSON.stringify({
      schema_version: 'knowledge-execution-authority/1.0',
      session_id: context.created.session_id,
      execution_id: context.executionId,
      generation: context.generation,
      run_id: context.created.run_id,
      request_id: requestId,
      expected_execution_revision: context.revision,
      owner_id: context.claim.owner_id,
      owner_kind: context.claim.owner_kind,
      lease_epoch: context.claim.epoch,
      lease_id: context.claim.lease_id,
    }), 'utf8');
    writeAuthority('req-knowledge-stage');
    process.env.MAESTRO_EXECUTION_AUTHORITY_FILE = authorityPath;

    const stageArgs = [
      'stage', 'knowhow', 'Execution sidecar rule', 'Fence Run sidecars with Execution authority.',
      '--run', context.created.run_id, '--session', context.created.session_id,
      '--signal', 'validated', '--signal-ids', 'spec:execution-stage', '--allow-unknown', '--json',
    ];
    await run(...stageArgs);
    expect(process.exitCode ?? 0).toBe(0);
    const staged = JSON.parse(logs.at(-1)!) as { candidate_id: string };
    await run(...stageArgs);
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ candidate_id: staged.candidate_id });
    expect(readRunKnowledgeDelta(context.store, context.created.session_id, context.created.run_id)
      .candidates[0].occurrences).toBe(1);
    expect(readRunKnowledgeDelta(context.store, context.created.session_id, context.created.run_id).inputs)
      .toEqual([expect.objectContaining({ knowledge_id: 'spec:execution-stage', signal: 'validated' })]);

    writeAuthority('req-knowledge-record');
    await run(
      'record', 'spec:execution-authority', '--signal', 'validated', '--source', 'manual',
      '--run', context.created.run_id, '--session', context.created.session_id,
      '--allow-unknown', '--json',
    );
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ recorded: 1, run_id: context.created.run_id });

    const receiptDir = join(
      context.store.executionDir(context.created.session_id, context.executionId),
      'sidecar-transitions',
    );
    const receipts = readdirSync(receiptDir)
      .map(file => readFileSync(join(receiptDir, file), 'utf8'))
      .join('\n');
    expect(receipts).not.toContain(context.claim.lease_id);
    expect(receipts).toContain('lease_id_hash');
    expect(receipts).toContain('knowledge-stage');
    expect(receipts).toContain('knowledge-record');
    expect(errors).toEqual([]);
  });

  it('rejects stale revision, stale or spoofed lease, wrong generation, and wrong Session authority', async () => {
    const context = createExecutionKnowledgeRun('knowledge-execution-fences');
    const attempts: Array<{
      request: string;
      override: Parameters<typeof executionAuthorityArgs>[2];
      error: string;
    }> = [
      { request: 'req-stale-revision', override: { revision: context.revision - 1 }, error: 'execution revision conflict' },
      { request: 'req-spoofed-token', override: { leaseId: `${context.claim.lease_id}-spoofed` }, error: 'lease fence conflict' },
      { request: 'req-wrong-generation', override: { generation: context.generation + 1 }, error: 'generation conflict' },
    ];
    for (const attempt of attempts) {
      errors = [];
      process.exitCode = undefined;
      await run(
        'record', 'spec:fenced', '--run', context.created.run_id, '--session', context.created.session_id,
        '--allow-unknown', ...executionAuthorityArgs(context, attempt.request, attempt.override),
      );
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain(attempt.error);
    }

    context.store.updateExecution(
      context.created.session_id,
      context.executionId,
      context.revision,
      execution => { execution.lease!.heartbeat_at = new Date(0).toISOString(); },
    );
    errors = [];
    process.exitCode = undefined;
    await run(
      'record', 'spec:stale-lease', '--run', context.created.run_id, '--session', context.created.session_id,
      '--allow-unknown', ...executionAuthorityArgs(context, 'req-stale-lease'),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('lease is stale');

    const wrongAuthority = join(projectRoot, 'wrong-session-authority.json');
    writeFileSync(wrongAuthority, JSON.stringify({
      schema_version: 'knowledge-execution-authority/1.0',
      session_id: 'spoofed-session',
      execution_id: context.executionId,
      generation: context.generation,
      run_id: context.created.run_id,
      request_id: 'req-wrong-session',
      expected_execution_revision: context.revision,
      owner_id: context.claim.owner_id,
      owner_kind: context.claim.owner_kind,
      lease_epoch: context.claim.epoch,
      lease_id: context.claim.lease_id,
    }), 'utf8');
    errors = [];
    process.exitCode = undefined;
    await run(
      'record', 'spec:wrong-session', '--run', context.created.run_id, '--session', context.created.session_id,
      '--allow-unknown', '--execution-authority', wrongAuthority,
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('not knowledge-execution-fences');
    expect(readRunKnowledgeDelta(context.store, context.created.session_id, context.created.run_id).inputs).toEqual([]);
  });

  it('rejects request conflicts and a sealed Run without mutating its ledger', async () => {
    const context = createExecutionKnowledgeRun('knowledge-execution-sealed');
    const authority = executionAuthorityArgs(context, 'req-stage-conflict');
    await run(
      'stage', 'spec', 'First request', 'First content.',
      '--run', context.created.run_id, '--session', context.created.session_id, ...authority,
    );
    expect(process.exitCode ?? 0).toBe(0);
    errors = [];
    process.exitCode = undefined;
    await run(
      'stage', 'spec', 'Conflicting request', 'Different content.',
      '--run', context.created.run_id, '--session', context.created.session_id, ...authority,
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('request_id req-stage-conflict was already used');

    const runDir = context.store.runDir(context.created.session_id, context.created.run_id);
    writeFileSync(
      join(runDir, 'report.md'),
      '---\nverdict: ready\nsummary: sealed\nconstraints: []\ndecisions: []\nconcerns: []\nnext: []\n---\nsealed\n',
      'utf8',
    );
    completeExecutionRun(projectRoot, context.created.run_id, {
      sessionId: context.created.session_id,
      executionId: context.executionId,
      generation: context.generation,
      expectedExecutionRevision: context.revision,
      executionLease: executionClaim(context.claim),
      requestId: 'req-complete-knowledge-run',
    });
    const sealedRevision = context.store.readExecution(context.created.session_id, context.executionId).revision;
    errors = [];
    process.exitCode = undefined;
    await run(
      'record', 'spec:sealed', '--run', context.created.run_id, '--session', context.created.session_id,
      '--allow-unknown', ...executionAuthorityArgs(context, 'req-record-sealed', { revision: sealedRevision }),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/not the active Run|sealed/);
    expect(readRunKnowledgeDelta(context.store, context.created.session_id, context.created.run_id).candidates)
      .toHaveLength(1);
  });
});

describe('maestro knowledge Run lifecycle CLI', () => {
  it('resolves --repo during stage and freezes the full canonical target payload', async () => {
    const sourceIdentity = initializeRepositoryIdentity(projectRoot, { repoName: 'CLI Source' });
    const targetRoot = join(projectRoot, 'linked-target');
    v2Workspace(targetRoot);
    const targetIdentity = initializeRepositoryIdentity(targetRoot, { repoName: 'CLI Target' });
    const configPath = join(projectRoot, '.workflow', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.workspaces = { linked: [{
      name: 'library', path: targetRoot, repo_id: targetIdentity.repo_id,
      share: ['knowhow'], write: ['knowhow'],
    }] };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      intent: 'freeze linked promotion target',
    });

    await run(
      'stage', 'knowhow', 'CLI linked recipe', 'Preserve every canonical field.',
      '--run', created.run_id, '--repo', 'library', '--type', 'recipe',
      '--category', 'coding', '--keywords', 'linked,canonical',
      '--source-ref', 'issue:cli-linked', '--related-path', 'src/index.ts',
      '--applies-to-repo', 'current', '--language', 'typescript', '--tool', '--json',
    );
    expect(process.exitCode).toBeUndefined();
    const delta = readRunKnowledgeDelta(new SessionStore(projectRoot), created.session_id, created.run_id, true);
    expect(delta).toMatchObject({
      schema_version: 'run-knowledge-delta/1.1',
      source_repository: { repo_id: sourceIdentity.repo_id },
    });
    expect(delta.candidates).toHaveLength(1);
    expect(delta.candidates[0]).toMatchObject({
      schema_version: 'knowledge-candidate/1.1',
      repository_binding: {
        source_repo_id: sourceIdentity.repo_id,
        target_repo_id: targetIdentity.repo_id,
        target_alias_snapshot: 'library',
      },
      payload: {
        kind: 'knowhow', type: 'recipe', category: 'coding',
        keywords: ['canonical', 'linked'], sourceRef: 'issue:cli-linked',
        relatedPaths: ['src/index.ts'],
        // Physical storage target and logical applicability are independent.
        appliesToRepoIds: [sourceIdentity.repo_id],
        language: 'typescript', tool: true,
      },
    });
  });

  it('stages candidates with inline signals on the active Run', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'exercise knowledge lifecycle CLI',
    });

    await run(
      'stage',
      'knowhow',
      'Stable transaction recipe',
      'Use one SessionStore transaction for coordinated writes.',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--category',
      'recipe',
      '--evidence',
      'artifact:A-1',
      '--signal',
      'validated',
      '--signal-ids',
      'spec:S-1,knowhow:K-1',
      '--allow-unknown',
      '--json',
    );
    const staged = JSON.parse(logs.at(-1)!) as { candidate_id: string; signal_recorded: number };
    expect(staged.candidate_id).toMatch(/^KDC-[a-f0-9]{16}$/);
    expect(staged.signal_recorded).toBe(2);

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([
      expect.objectContaining({ knowledge_id: 'spec:S-1', signal: 'validated', source: 'manual' }),
      expect.objectContaining({ knowledge_id: 'knowhow:K-1', signal: 'validated', source: 'manual' }),
    ]);
    expect(summarizeSessionKnowledge(projectRoot, created.session_id).candidates).toEqual([
      expect.objectContaining({
        candidate_id: staged.candidate_id,
        target: 'knowhow',
        status: 'pending',
      }),
    ]);
    expect(errors).toEqual([]);
  });

  it('stages a transcript descriptor from a file and keeps quote out of review output', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-transcript-session',
      intent: 'exercise transcript evidence CLI',
    });
    const descriptorPath = join(projectRoot, 'quote.json');
    const rawQuote = 'sensitive raw transcript text';
    writeFileSync(descriptorPath, JSON.stringify({
      host_kind: 'pi',
      host_session_id: 'host-session-1',
      entry_id: 'entry-1',
      quote: rawQuote,
    }), 'utf8');

    await run(
      'stage', 'knowhow', 'Distilled transcript rule', 'Use a distilled and verified rule.',
      '--run', created.run_id,
      '--session', created.session_id,
      '--transcript-quote', descriptorPath,
      '--json',
    );
    const delta = readRunKnowledgeDelta(new SessionStore(projectRoot), created.session_id, created.run_id);
    expect(delta.candidates).toHaveLength(1);
    expect(delta.candidates[0].content).toBe('Use a distilled and verified rule.');
    expect(delta.candidates[0].evidence_refs.some(ref => ref.startsWith('transcript:pi:host-session-1:entry-1:')))
      .toBe(true);
    const evidenceDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'transcript-evidence');
    expect(readdirSync(evidenceDir)).toHaveLength(1);

    logs = [];
    await run('review', created.session_id);
    expect(logs.join('\n')).toContain('[untrusted]');
    expect(logs.join('\n')).not.toContain(rawQuote);
    expect(errors).toEqual([]);
  });

  it('stages and records on a v3 Run without reading retained legacy Executions', async () => {
    const context = createV3RunWithRetainedExecution();

    await run(
      'stage', 'knowhow', 'V3 retained execution rule', 'Use the canonical Run v3 sidecar.',
      '--run', context.runId, '--session', context.sessionId, '--json',
    );
    expect(process.exitCode ?? 0).toBe(0);
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ run_id: context.runId });

    await run(
      'record', 'spec:v3-authority', '--signal', 'validated', '--source', 'manual',
      '--run', context.runId, '--session', context.sessionId, '--allow-unknown', '--json',
    );
    expect(process.exitCode ?? 0).toBe(0);
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ run_id: context.runId, recorded: 1 });
    expect(errors).toEqual([]);
  });

  it('rejects invalid transcript locator fields before writing snapshot or candidate', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-transcript-invalid-session',
      intent: 'reject invalid transcript locator',
    });
    const descriptorPath = join(projectRoot, 'invalid-quote.json');
    writeFileSync(descriptorPath, JSON.stringify({
      host_kind: 'pi',
      host_session_id: 'bad:session',
      entry_id: 'entry-1',
      quote: 'must not persist',
    }), 'utf8');

    await run(
      'stage', 'knowhow', 'Invalid transcript', 'Distilled content.',
      '--run', created.run_id,
      '--session', created.session_id,
      '--transcript-quote', descriptorPath,
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('cannot round-trip');
    const evidenceDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'transcript-evidence');
    expect(existsSync(evidenceDir)).toBe(false);
    const delta = readRunKnowledgeDelta(new SessionStore(projectRoot), created.session_id, created.run_id);
    expect(delta.candidates).toEqual([]);
  });

  it('rejects invalid signal options before staging a candidate', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'validate signal options before mutation',
    });

    await run(
      'stage',
      'knowhow',
      'Must not persist',
      'Invalid signal options must leave the Run ledger unchanged.',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--signal',
      'unsupported',
      '--signal-ids',
      'spec:S-1',
    );

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([]);
    expect(delta.candidates).toEqual([]);
    expect(errors).toContain('Error: --signal must be one of consumed, cited, validated, contradicted');
  });

  it('fails closed when explicit Run authority is not active', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'reject stale knowledge attribution',
    });
    const store = new SessionStore(projectRoot);
    store.update(created.session_id, bundle => {
      bundle.session.active_run_id = null;
    });

    await run(
      'stage', 'spec', 'Blocked', 'content',
      '--run', created.run_id, '--session', created.session_id,
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('is not the active Run');
  });

  it('reconciles and resolves a candidate through the CLI', async () => {
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'coding-conventions.md'), `---
category: coding
---

<spec-entry category="coding" keywords="store" date="2026-07-28" sid="S-store" title="Store rule">

### Store rule

Use one SessionStore transaction.

</spec-entry>
`, 'utf8');
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'reconcile CLI candidate',
    });
    await run(
      'stage',
      'spec',
      'Store rule copy',
      'Use one SessionStore transaction.',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--json',
    );
    const candidateId = (JSON.parse(logs.at(-1)!) as { candidate_id: string }).candidate_id;

    await run(
      'reconcile',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--json',
    );
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      counts: { duplicates: 1, suppressed: 1 },
      candidates: [{
        candidate_id: candidateId,
        disposition: 'exact_duplicate',
        canonical_id: 'S-store',
      }],
    });
    await run('review', created.session_id, '--json');
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      candidates: [{
        candidate_id: candidateId,
        reconciliation: {
          disposition: 'exact_duplicate',
          freshness: 'fresh',
        },
      }],
    });

    // Make the reviewed corpus stale before using the deprecated resolve path.
    // The command must refresh the receipt through the same fence as promote.
    writeFileSync(join(specsDir, 'unrelated.md'), `---
category: coding
---

<spec-entry category="coding" keywords="freshness" date="2026-07-29" sid="S-freshness" title="Freshness marker">

### Freshness marker

Keep corpus freshness explicit.

</spec-entry>
`, 'utf8');

    await run(
      'review',
      created.session_id,
      '--resolve',
      candidateId,
      '--as',
      'duplicate',
      '--target',
      'S-store',
      '--reason',
      'Confirmed exact duplicate',
      '--json',
    );
    const reviewAfterResolve = JSON.parse(logs.at(-1)!);
    expect(reviewAfterResolve.candidates[0].reconciliation.promotion_eligibility).toBe('suppressed');
    expect(readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    ).candidates[0].status).toBe('rejected');
    expect(errors).toEqual([]);
  });

  it('reviews evidence, supports --workflow-root, and stages content from a file', async () => {
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'coding-conventions.md'), `---
category: coding
---

<spec-entry category="coding" keywords="atomic" date="2026-07-28" sid="S-atomic" title="Atomic rule">

### Atomic rule

Persist coordinated writes atomically.

</spec-entry>
`, 'utf8');
    writeFileSync(
      join(projectRoot, 'candidate.txt'),
      'Persist coordinated writes atomically.',
      'utf8',
    );
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-review-session',
      intent: 'review candidate evidence',
    });

    process.chdir(previousCwd);
    await run(
      'stage',
      'spec',
      'Atomic rule copy',
      '--content-file',
      'candidate.txt',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--workflow-root',
      projectRoot,
      '--json',
    );
    const candidateId = (JSON.parse(logs.at(-1)!) as { candidate_id: string }).candidate_id;

    await run(
      'review',
      created.session_id,
      '--refresh',
      '--workflow-root',
      projectRoot,
      '--json',
    );
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      session_id: created.session_id,
      candidates: [{
        candidate_id: candidateId,
        reconciliation: {
          disposition: 'exact_duplicate',
          promotion_eligibility: 'suppressed',
          freshness: 'fresh',
          matches: [{
            knowledge_id: 'S-atomic',
            relation: 'exact_duplicate',
          }],
        },
        review: {
          freshness: 'fresh',
          reconcile_commands: [],
          resolution_commands: [],
        },
      }],
    });
    expect(errors).toEqual([]);
  });

  it('rejects restaging identical content with a conflicting action', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-action-session',
      intent: 'preserve candidate intent',
    });
    await run(
      'stage',
      'knowhow',
      'Candidate action',
      'Keep one semantic candidate identity.',
      '--action',
      'propose',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
    );
    await run(
      'stage',
      'knowhow',
      'Candidate action',
      'Keep one semantic candidate identity.',
      '--action',
      'supersede',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
    );

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('instead of restaging');
  });

  it('executes the complete knowledge review, promotion, and Session seal chain', async () => {
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const specPath = join(specsDir, 'architecture-constraints.md');
    writeFileSync(specPath, `---
category: arch
---

<spec-entry category="arch" keywords="storage" date="2026-07-01" sid="S-old-storage" title="Canonical storage policy">

### Canonical storage policy

Use independent file writes for coordinated state.

</spec-entry>
`, 'utf8');
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-full-chain',
      intent: 'exercise the full knowledge lifecycle',
    });

    await run(
      'stage',
      'spec',
      'Canonical storage policy',
      'Use one SessionStore transaction for coordinated state.',
      '--action',
      'supersede',
      '--category',
      'arch',
      '--evidence',
      'report.md#decision-storage',
      '--signal',
      'consumed',
      '--signal-ids',
      'S-old-storage',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--allow-unknown',
      '--json',
    );
    const candidateId = (JSON.parse(logs.at(-1)!) as { candidate_id: string }).candidate_id;

    await run('review', created.session_id, '--refresh', '--json');
    const preCompletionReview = JSON.parse(logs.at(-1)!) as {
      candidates: Array<{
        candidate_id: string;
        reconciliation: {
          disposition: string;
          promotion_eligibility: string;
          canonical_id: string;
        };
        review: { resolution_commands: string[] };
      }>;
    };
    expect(preCompletionReview.candidates).toEqual([
      expect.objectContaining({
        candidate_id: candidateId,
        reconciliation: expect.objectContaining({
          disposition: 'supersede_candidate',
          promotion_eligibility: 'review_required',
          canonical_id: 'S-old-storage',
        }),
        review: expect.objectContaining({
          resolution_commands: expect.arrayContaining([
            expect.stringContaining('--as supersede --target S-old-storage'),
          ]),
        }),
      }),
    ]);

    await run(
      'review',
      created.session_id,
      '--resolve',
      candidateId,
      '--as',
      'supersede',
      '--target',
      'S-old-storage',
      '--reason',
      'Coordinated state now requires one atomic SessionStore transaction',
      '--json',
    );
    const resolvedView = JSON.parse(logs.at(-1)!);
    expect(resolvedView.candidates[0].reconciliation.promotion_eligibility).toBe('eligible');

    const runDir = new SessionStore(projectRoot).runDir(created.session_id, created.run_id);
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Full knowledge lifecycle verified
constraints: []
decisions: []
concerns: []
next: []
---
Full knowledge lifecycle verified.
`, 'utf8');
    const completed = completeRun(projectRoot, created.run_id, created.session_id);
    expect(completed).toMatchObject({
      sealed: true,
      knowledge: {
        staged_candidate_ids: [candidateId],
        reconciliation: {
          review_required: 0,
          suppressed: 0,
        },
      },
    });

    await run('review', created.session_id, '--json');
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      candidates: [{
        candidate_id: candidateId,
        status: 'pending',
        reconciliation: {
          disposition: 'supersede_candidate',
          promotion_eligibility: 'eligible',
          freshness: 'fresh',
        },
      }],
    });

    await run(
      'promote',
      created.session_id,
      '--candidate',
      candidateId,
      '--json',
    );
    const promotion = JSON.parse(logs.at(-1)!) as {
      promoted: Array<{ candidate_id: string; promoted_id: string; outcome: string }>;
    };
    expect(promotion.promoted).toEqual([
      expect.objectContaining({
        candidate_id: candidateId,
        promoted_id: expect.stringMatching(/^S-/),
        outcome: 'created',
      }),
    ]);
    const promotedId = promotion.promoted[0].promoted_id;

    const sealed = sealSession(projectRoot, created.session_id, 'full knowledge chain verified');
    expect(sealed).toMatchObject({
      status: 'sealed',
      run_count: 1,
      knowledge: {
        pending_candidates: 0,
        promoted_candidates: 1,
        review_command: `maestro knowledge review ${created.session_id}`,
      },
    });

    const specContent = readFileSync(specPath, 'utf8');
    expect(specContent).toContain('sid="S-old-storage" title="Canonical storage policy" status="deprecated"');
    expect(specContent).toContain(`superseded-by="${promotedId}"`);
    expect(specContent).toContain(`sid="${promotedId}"`);
    expect(specContent).toContain('supersedes="S-old-storage"');

    const searchResults = await runUnifiedSearch('SessionStore transaction coordinated state', {
      type: 'spec',
      limit: 5,
      executionMode: 'read-only-probe',
    });
    expect(searchResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Canonical storage policy',
        snippet: expect.stringContaining('SessionStore transaction'),
      }),
    ]));
    expect(searchResults.some(result => result.id === 'S-old-storage')).toBe(false);
    expect(errors).toEqual([]);
  });

  it('records search attribution on the active Run without staging a candidate', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'record search attribution',
    });

    await run(
      'record',
      'spec:S-1',
      'knowhow:K-1',
      '--signal',
      'consumed',
      '--source',
      'search',
      '--allow-unknown',
      '--json',
    );
    const recorded = JSON.parse(logs.at(-1)!) as { session_id: string; run_id: string; recorded: number };
    expect(recorded).toMatchObject({ session_id: created.session_id, run_id: created.run_id, recorded: 2 });

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([
      expect.objectContaining({ knowledge_id: 'spec:S-1', signal: 'consumed', source: 'search' }),
      expect.objectContaining({ knowledge_id: 'knowhow:K-1', signal: 'consumed', source: 'search' }),
    ]);
    expect(delta.candidates).toEqual([]);
    // Narrowed-scan attribution is allowed but always warned (K3 tier C).
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('No caller identity found');
  });

  it('records explicit run attribution with manual source and validated signal', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'record explicit manual attribution',
    });

    await run(
      'record',
      'spec:rules-7',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--signal',
      'validated',
      '--source',
      'manual',
      '--allow-unknown',
      '--json',
    );
    const recorded = JSON.parse(logs.at(-1)!) as { recorded: number };
    expect(recorded.recorded).toBe(1);

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([
      expect.objectContaining({ knowledge_id: 'spec:rules-7', signal: 'validated', source: 'manual' }),
    ]);
    expect(errors).toEqual([]);
  });

  it('rejects invalid record options before touching the ledger', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'reject invalid record options',
    });

    await run('record', 'spec:S-1', '--signal', 'unsupported', '--source', 'search');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--signal must be one of consumed, cited, validated, contradicted');

    await run('record', 'spec:S-1', '--signal', 'consumed', '--source', 'injection');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--source must be one of search, load, manual');

    // --session without --run is now legal (session-source attribution); the
    // fake ID must still be rejected by K8 validation before any ledger write.
    await run('record', 'spec:S-1', '--session', created.session_id);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unknown knowledge ID(s)');

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([]);
  });

  it('attributes a lone running Session without an active Run (narrowed session branch)', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'record without active run resolves to session',
    });
    const store = new SessionStore(projectRoot);
    store.update(created.session_id, bundle => {
      bundle.session.active_run_id = null;
    });

    await run('record', 'spec:S-1', '--signal', 'consumed', '--source', 'search', '--allow-unknown', '--json');
    expect(process.exitCode ?? 0).toBe(0);
    const recorded = JSON.parse(logs.at(-1)!) as { session_id: string; origin: string; recorded: number };
    expect(recorded).toMatchObject({ session_id: created.session_id, origin: 'session', recorded: 1 });
  });

  it('fails closed when write authority is ambiguous for record', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'reject record without active run',
    });
    const store = new SessionStore(projectRoot);
    store.update(created.session_id, bundle => {
      bundle.session.active_run_id = null;
    });
    // A second running Session makes authority ambiguous (no unique target).
    createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-other',
      intent: 'second running session',
    });

    await run('record', 'spec:S-1', '--signal', 'consumed', '--source', 'search');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Knowledge write authority is ambiguous');
  });

  it('summarizes input totals by source with knowledge-id detail', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'summarize by-source attribution',
    });
    await run(
      'record', 'spec:A', '--signal', 'consumed', '--source', 'search',
      '--run', created.run_id, '--session', created.session_id, '--allow-unknown', '--json',
    );
    await run(
      'record', 'spec:B', '--signal', 'validated', '--source', 'load',
      '--run', created.run_id, '--session', created.session_id, '--allow-unknown', '--json',
    );

    const summary = summarizeSessionKnowledge(projectRoot, created.session_id);
    expect(summary.input_totals).toEqual({ consumed: 1, cited: 0, validated: 1, contradicted: 0 });
    expect(summary.input_totals_by_source.search).toEqual(
      { consumed: 1, cited: 0, validated: 0, contradicted: 0 },
    );
    expect(summary.input_totals_by_source.load).toEqual(
      { consumed: 0, cited: 0, validated: 1, contradicted: 0 },
    );
    expect(summary.inputs).toEqual([
      { run_id: created.run_id, knowledge_id: 'spec:A', signal: 'consumed', source: 'search', count: 1 },
      { run_id: created.run_id, knowledge_id: 'spec:B', signal: 'validated', source: 'load', count: 1 },
    ]);
  });

  it('rejects unknown knowledge IDs by default (K8)', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'knowledge-cli-session',
      intent: 'reject unknown signal ids',
    });
    await run(
      'record',
      'spec:definitely-not-in-index',
      '--run',
      created.run_id,
      '--session',
      created.session_id,
      '--signal',
      'validated',
      '--source',
      'manual',
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unknown knowledge ID(s)');
    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([]);
  });

  it('stages on an explicit session without a run (session source)', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'session-source-cli',
      intent: 'session-source staging via CLI',
    });
    const srcDir = join(projectRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'session-source.ts'), '// reviewed CLI evidence\n', 'utf8');
    await run(
      'stage',
      'knowhow',
      'Session-source recipe',
      'Staged through the session ledger without a run.',
      '--session',
      created.session_id,
      '--evidence',
      'src/session-source.ts:9',
      '--json',
    );
    const staged = JSON.parse(logs.at(-1)!) as { candidate_id: string; session_id: string; origin: string };
    expect(staged.origin).toBe('session');
    expect(staged.session_id).toBe(created.session_id);
    const summary = summarizeSessionKnowledge(projectRoot, created.session_id);
    const candidate = summary.candidates.find(item => item.candidate_id === staged.candidate_id);
    expect(candidate?.origin).toBe('session');
    expect(candidate?.run_ids).toEqual([]);
  });

  it('prints the run-less next-step card on session-source staging', async () => {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: 'session-source-card',
      intent: 'session-source staging next-step card',
    });
    const srcDir = join(projectRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'session-source-card.ts'), '// reviewed CLI evidence\n', 'utf8');
    await run(
      'stage',
      'knowhow',
      'Session-source card recipe',
      'Staged without a run should show the next-step card.',
      '--session',
      created.session_id,
      '--evidence',
      'src/session-source-card.ts:9',
    );
    const output = logs.join('\n');
    expect(output).toContain('review after completion with "maestro knowledge review');
    expect(output).toContain('Next: run the review, present each candidate to the user');
    expect(output).toContain('maestro spec supersede <old-sid> --by <new-sid>');
    expect(output).toContain('stage after evidence files are finalized');
    expect(output).toContain('Fast path: for a standalone insight that needs no Run/Session binding');
  });
});

describe('maestro knowledge audit CLI', () => {
  it('does not expose the removed mutating --apply option', async () => {
    await expect(run('audit', '--apply')).rejects.toThrow(/unknown option '--apply'/);
  });
});

describe('maestro knowledge normalize CLI', () => {
  it('writes a dry-run report first and applies only that reviewed snapshot', async () => {
    const repo = initializeRepositoryIdentity(projectRoot, { repoName: 'Normalize CLI' });
    const knowhowDir = join(projectRoot, '.workflow', 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    const entry = join(knowhowDir, 'TIP-20260801-cli-normalize.md');
    writeFileSync(entry, `---\ntitle: CLI normalize\ntype: tip\ntags: [legacy]\nlang: typescript\n---\n\nNormalize explicitly.\n`, 'utf8');
    const report = join('.workflow', 'knowledge-normalize.json');

    await run('normalize', '--report', report, '--json');
    expect(process.exitCode ?? 0).toBe(0);
    const planned = JSON.parse(logs.at(-1)!);
    expect(planned).toMatchObject({
      schema_version: 'knowledge-normalization-report/1.0',
      mode: 'dry-run',
      repo_id: repo.repo_id,
      safety: { report_required_before_apply: true, automatic_bulk_rewrite: false },
    });
    expect(readFileSync(entry, 'utf8')).toContain('tags:');

    logs = [];
    await run('normalize', '--report', report, '--apply', '--json');
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ applied: 1, unresolved: 0 });
    const normalized = readFileSync(entry, 'utf8');
    expect(normalized).toContain('keywords:');
    expect(normalized).toContain('language: typescript');
    expect(normalized).toContain(repo.repo_id);
    expect(normalized).not.toContain('tags:');
  });
});

describe('maestro knowledge promote --resolve inline adjudication', () => {
  /** Stage a run-source spec candidate, then seal the Run via completeRun. */
  async function stageAndSealSpecCandidate(options: {
    sessionId: string;
    intent: string;
    title: string;
    content: string;
    action?: string;
    category?: string;
    evidence?: string;
  }): Promise<{ session_id: string; run_id: string; candidate_id: string }> {
    const created = createRun({
      projectRoot,
      command: 'knowledge-cli',
      sessionId: options.sessionId,
      intent: options.intent,
    });
    const args = ['stage', 'spec', options.title, options.content];
    if (options.action) args.push('--action', options.action);
    if (options.category) args.push('--category', options.category);
    if (options.evidence) args.push('--evidence', options.evidence);
    args.push('--run', created.run_id, '--session', created.session_id, '--json');
    await run(...args);
    const candidateId = (JSON.parse(logs.at(-1)!) as { candidate_id: string }).candidate_id;
    const runDir = new SessionStore(projectRoot).runDir(created.session_id, created.run_id);
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: ${options.intent}
constraints: []
decisions: []
concerns: []
next: []
---
${options.intent}.
`, 'utf8');
    completeRun(projectRoot, created.run_id, created.session_id);
    return { session_id: created.session_id, run_id: created.run_id, candidate_id: candidateId };
  }

  it('promotes a unique candidate inline with --resolve without --target and writes the corpus', async () => {
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-unique',
      intent: 'inline unique resolution and promotion',
      title: 'Inline unique rule',
      content: 'Use one atomic inline resolution transaction for coordinated promotion.',
      category: 'arch',
    });

    await run(
      'promote',
      session_id,
      '--resolve',
      candidate_id,
      '--as',
      'unique',
      '--reason',
      'Genuinely new rule with no corpus match',
      '--json',
    );
    const promotion = JSON.parse(logs.at(-1)!) as {
      promoted: Array<{ candidate_id: string; promoted_id: string; outcome: string }>;
      skipped_review_required: string[];
    };
    expect(promotion.promoted).toEqual([
      expect.objectContaining({
        candidate_id,
        promoted_id: expect.stringMatching(/^S-/),
        outcome: 'created',
      }),
    ]);
    expect(promotion.skipped_review_required).toEqual([]);
    // Corpus write: the promoted content landed in the project spec corpus.
    const specsDir = join(projectRoot, '.workflow', 'specs');
    const corpus = readdirSync(specsDir).map(file => readFileSync(join(specsDir, file), 'utf8')).join('\n');
    expect(corpus).toContain('Use one atomic inline resolution transaction for coordinated promotion.');
    expect(errors).toEqual([]);
  });

  it('rejects a non-unique inline resolution without --target', async () => {
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-no-target',
      intent: 'inline resolution without target must fail closed',
      title: 'Inline duplicate claim',
      content: 'Claimed to duplicate knowledge that does not exist in the corpus.',
    });

    await run(
      'promote',
      session_id,
      '--resolve',
      candidate_id,
      '--as',
      'duplicate',
      '--reason',
      'claimed duplicate',
      '--json',
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--target is required for duplicate resolution');
  });

  it('rejects an inline resolution with an empty --reason', async () => {
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-empty-reason',
      intent: 'inline resolution with empty reason must fail closed',
      title: 'Inline reason rule',
      content: 'A resolution without a human reason must never be accepted.',
    });

    await run(
      'promote',
      session_id,
      '--resolve',
      candidate_id,
      '--as',
      'unique',
      '--reason',
      '   ',
      '--json',
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--resolve requires a non-empty --reason');
  });

  it('resolves a supersede candidate inline and promotes with a corpus write', async () => {
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const specPath = join(specsDir, 'architecture-constraints.md');
    writeFileSync(specPath, `---
category: arch
---

<spec-entry category="arch" keywords="storage" date="2026-07-01" sid="S-old-storage" title="Canonical storage policy">

### Canonical storage policy

Use independent file writes for coordinated state.

</spec-entry>
`, 'utf8');
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-supersede',
      intent: 'inline supersede resolution and promotion',
      title: 'Canonical storage policy',
      content: 'Use one SessionStore transaction for coordinated state.',
      action: 'supersede',
      category: 'arch',
      evidence: 'report.md#decision-storage',
    });

    await run(
      'promote',
      session_id,
      '--resolve',
      candidate_id,
      '--as',
      'supersede',
      '--target',
      'S-old-storage',
      '--reason',
      'Coordinated state now requires one atomic SessionStore transaction',
      '--json',
    );
    const promotion = JSON.parse(logs.at(-1)!) as {
      promoted: Array<{ candidate_id: string; promoted_id: string; outcome: string }>;
    };
    expect(promotion.promoted).toEqual([
      expect.objectContaining({
        candidate_id,
        promoted_id: expect.stringMatching(/^S-/),
        outcome: 'created',
      }),
    ]);
    const promotedId = promotion.promoted[0].promoted_id;
    const specContent = readFileSync(specPath, 'utf8');
    expect(specContent).toContain('sid="S-old-storage" title="Canonical storage policy" status="deprecated"');
    expect(specContent).toContain(`superseded-by="${promotedId}"`);
    expect(specContent).toContain(`sid="${promotedId}"`);
    expect(errors).toEqual([]);
  });

  it('rejects --resolve combined with --all', async () => {
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-all-mutex',
      intent: 'inline resolution must not combine with bulk promote',
      title: 'Inline mutex rule',
      content: 'Resolving a single candidate and bulk promotion are mutually exclusive intents.',
    });

    await run(
      'promote',
      session_id,
      '--all',
      '--resolve',
      candidate_id,
      '--as',
      'unique',
      '--reason',
      'not combined',
      '--json',
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('mutually exclusive');
  });

  it('hints the supersede fallback when the resolution target is not an evidence-backed match', async () => {
    const { session_id, candidate_id } = await stageAndSealSpecCandidate({
      sessionId: 'promote-resolve-target-miss',
      intent: 'supersede resolution with a non-matching target must hint the fallback',
      title: 'Supersede fallback rule',
      content: 'A target outside the reconciliation matches cannot be superseded inline.',
      action: 'supersede',
      category: 'arch',
    });

    await run(
      'promote',
      session_id,
      '--resolve',
      candidate_id,
      '--as',
      'supersede',
      '--target',
      'spec:project:not-in-matches',
      '--reason',
      'unrelated target',
      '--json',
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('is not an evidence-backed match');
    expect(errors.join('\n')).toContain('use --as unique to promote without a target');
    expect(errors.join('\n')).toContain('maestro spec supersede <old-sid> --by <new-sid>');
  });
});
