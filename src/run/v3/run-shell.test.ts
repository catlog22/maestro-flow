import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerRunV3Command } from '../../commands/run-v3.js';
import { runResponseV12Schema } from '../protocol-schemas.js';
import type { RunV30, SessionStateV30 } from '../schemas.js';
import { SessionStore } from '../store.js';
import { createRunningRunV3 } from './mutation-engine.js';
import { ensureV3RunShell } from './run-shell.js';

/** Byte-for-byte the v2 ensureRunShell report template (src/run/runtime.ts). */
const RUN_REPORT_TEMPLATE = '---\nverdict: ready\nsummary: ""\nconstraints: []\ndecisions: []\nconcerns: []\nnext: []\ndetails: {}\n---\n## 摘要\n\n## 结论/Verdict\n\n## 讨论/复盘\n\n## 产物\n\n## 交接/Next\n';

const roots: string[] = [];
const originalExitCode = process.exitCode;

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-v3-run-shell-'));
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
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 shell', definition_of_done: 'tests pass',
    status: 'open', orchestration_revision: 0, activity_revision: 0,
    chain: [
      { step_id: 'step-1', command: 'implement', args: [], status: 'running', run_ids: ['r-1'], goal_ref: null, decision_refs: [] },
      { step_id: 'step-2', command: 'verify', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] },
    ],
    decisions: [], active_run_ids: ['r-1'], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
}

function run(runId: string, stepId: string, status: RunV30['status'] = 'running'): RunV30 {
  return {
    schema_version: 'run/3.0', run_id: runId, session_id: 's-1', step_id: stepId,
    parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'implement', args: [], goal: null,
    status, revision: 0, actor_id: 'actor-a', input_refs: [], output_refs: [],
    primary_artifact_id: null, verdict: null, summary: null, legacy_execution_generation: null,
    created_at: '2026-08-12T00:00:00.000Z', started_at: status === 'running' ? '2026-08-12T00:00:00.000Z' : null,
    ended_at: null, sealed_at: null,
  };
}

function setup(): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30(session());
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  store.writeRunV30(run('r-1', 'step-1'));
  return store;
}

function setupNext(): SessionStore {
  const store = new SessionStore(root());
  store.writeSessionV30({
    schema_version: 'session/3.0', session_id: 's-1', objective: 'v3 shell next', definition_of_done: 'tests pass',
    status: 'open', orchestration_revision: 0, activity_revision: 0,
    chain: [
      { step_id: 'step-1', command: 'implement', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] },
    ],
    decisions: [], active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  });
  writeFileSync(join(store.sessionDir('s-1'), 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  return store;
}

/** Minimal session/3.0 CLI fixture (one pending chain step, no Run allocated). */
function cliFixture(): string {
  const value = root();
  const sessionDir = join(value, '.workflow', 'sessions', 's-v3');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  const session: SessionStateV30 = {
    schema_version: 'session/3.0', session_id: 's-v3', objective: 'exercise run next',
    definition_of_done: 'shell exists', status: 'open',
    orchestration_revision: 0, activity_revision: 0,
    chain: [{ step_id: 'step-1', command: 'implement', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] }],
    decisions: [], active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z', completed_at: null, archived_at: null,
  };
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
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

function mutationFlags(root: string, revisionFlag: string, revision = 0): string[] {
  return [
    '--session', 's-v3', '--participant', 'actor', '--actor', 'actor',
    '--request-id', `req-${Math.random()}`, revisionFlag, String(revision),
    '--reason', 'focused test', '--evidence', 'evidence-1', '--json', '--workflow-root', root,
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('v3 Run shell', () => {
  it('creates the v2-identical Run directory shell and report template', () => {
    const store = setup();
    const runDir = ensureV3RunShell(store, 's-1', 'r-1');
    expect(runDir).toBe(store.runDir('s-1', 'r-1'));
    for (const name of ['outputs', 'evidence', 'work']) {
      expect(existsSync(join(runDir, name))).toBe(true);
    }
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toBe(RUN_REPORT_TEMPLATE);
    expect(existsSync(join(runDir, 'diagnostics.ndjson'))).toBe(true);
  });

  it('is idempotent: never overwrites report.md and only appends empty diagnostics', () => {
    const store = setup();
    const runDir = ensureV3RunShell(store, 's-1', 'r-1');
    writeFileSync(join(runDir, 'report.md'), '# custom report\n', 'utf8');
    writeFileSync(join(runDir, 'diagnostics.ndjson'), '{"n":1}\n', 'utf8');
    const returned = ensureV3RunShell(store, 's-1', 'r-1');
    expect(returned).toBe(runDir);
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toBe('# custom report\n');
    expect(readFileSync(join(runDir, 'diagnostics.ndjson'), 'utf8')).toBe('{"n":1}\n');
  });

  it('leaves a Run shell created for the next Run after createRunningRunV3', () => {
    const store = setupNext();
    const mutation = createRunningRunV3(store, {
      sessionId: 's-1', requestId: 'req-next-shell', actorId: 'actor-a',
      reason: 'next shell test', expectedOrchestrationRevision: 0,
      run: run('r-2', 'step-1', 'pending'),
    });
    expect(mutation.status).toBe('applied');
    ensureV3RunShell(store, 's-1', 'r-2');
    const runDir = store.runDir('s-1', 'r-2');
    expect(existsSync(join(runDir, 'outputs'))).toBe(true);
    expect(existsSync(join(runDir, 'report.md'))).toBe(true);
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toBe(RUN_REPORT_TEMPLATE);
  });

  it('wires ensureV3RunShell into the run next action', async () => {
    const root = cliFixture();
    const response = await invoke(registerRunV3Command, [
      'run', 'next', '--run', 'run-next', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({ operation: 'next', ok: true, result: { run_id: 'run-next', status: 'running' } });
    const birth = response.result as Record<string, unknown>;
    expect(birth.run_dir).toBe(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-next'));
    expect(birth.step_id).toBe('step-1');
    expect(birth.run_already_created).toBe(true);
    expect((birth.brief as { command: string }).command).toBe('maestro run brief run-next --session s-v3 --json');
    expect(birth.task).toEqual({ command: 'implement', args: [], goal: null, input_refs: [] });
    expect(typeof (birth.guidance as { content_hash?: string } | null)?.content_hash).toBe('string');
    const brief = await invoke(registerRunV3Command, [
      'run', 'brief', 'run-next', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(brief).toMatchObject({
      operation: 'brief', ok: true,
      result: {
        schema_version: 'brief-result/3.0',
        session: { session_id: 's-v3', status: 'open', orchestration_revision: 1 },
        run: { run_id: 'run-next', status: 'running' },
      },
    });
    const briefResult = brief.result as Record<string, unknown>;
    expect((briefResult.knowledge_context as { path?: string } | null)?.path).toBeTruthy();
    expect((briefResult.next as { command: string }).command).toBe(
      'maestro run complete run-next --session s-v3 --actor <actor-id> '
      + '--expected-run-revision 1 '
      + '--expected-orchestration-revision 1 --verdict done --advance --json',
    );
    const runDir = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-next');
    for (const name of ['outputs', 'evidence', 'work']) {
      expect(existsSync(join(runDir, name))).toBe(true);
    }
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toBe(RUN_REPORT_TEMPLATE);
    expect(existsSync(join(runDir, 'diagnostics.ndjson'))).toBe(true);
  });

  it('wires ensureV3RunShell into the run create action', async () => {
    const root = cliFixture();
    const response = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', '--run', 'run-new', '--step', 'step-1',
      ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({ operation: 'create', ok: true, result: { run_id: 'run-new', status: 'running' } });
    const runDir = join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-new');
    expect(existsSync(join(runDir, 'outputs'))).toBe(true);
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toBe(RUN_REPORT_TEMPLATE);
  });
});
