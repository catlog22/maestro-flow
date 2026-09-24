import { Command } from 'commander';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runResponseV12Schema } from '../run/protocol-schemas.js';
import type { RunV30, SessionStateV30 } from '../run/schemas.js';
import { createSessionState } from '../run/defaults.js';
import { SessionStore } from '../run/store.js';
import { registerExecutionV3RetiredCommand } from './execution-v3-retired.js';
import { registerRunV3Command } from './run-v3.js';
import { registerSessionV3Command } from './session-v3.js';
import { emitV3Error } from './v3-cli-shared.js';

const roots: string[] = [];
const originalExitCode = process.exitCode;

function fixture(input: {
  status?: SessionStateV30['status'];
  stepStatus?: SessionStateV30['chain'][number]['status'];
  run?: Partial<RunV30>;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-v3-cli-'));
  roots.push(root);
  const sessionDir = join(root, '.workflow', 'sessions', 's-v3');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(root, '.workflow', 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }, null, 2)}\n`);
  writeFileSync(join(sessionDir, 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  const hasRun = input.run !== undefined;
  const session: SessionStateV30 = {
    schema_version: 'session/3.0', session_id: 's-v3', objective: 'exercise CLI',
    definition_of_done: 'commands persist atomically', status: input.status ?? 'open',
    orchestration_revision: 0, activity_revision: 0,
    chain: [{
      step_id: 'step-1', command: 'implement', args: [], status: input.stepStatus ?? 'pending',
      run_ids: hasRun ? ['run-1'] : [], goal_ref: null, decision_refs: [],
    }],
    decisions: [], active_run_ids: hasRun ? ['run-1'] : [],
    artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z',
    completed_at: null, archived_at: null,
  };
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  if (hasRun) {
    const runDir = join(sessionDir, 'runs', 'run-1');
    mkdirSync(runDir, { recursive: true });
    const run: RunV30 = {
      schema_version: 'run/3.0', run_id: 'run-1', session_id: 's-v3', step_id: 'step-1',
      parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'implement', args: [], goal: null,
      status: 'pending', revision: 0, actor_id: 'actor',
      input_refs: [], output_refs: [], primary_artifact_id: null, verdict: null, summary: null,
      created_at: '2026-08-12T00:00:00.000Z', started_at: null, ended_at: null, sealed_at: null,
      ...input.run,
    };
    writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  }
  return root;
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

function writeInputArtifact(root: string, artifactId: string, status: 'draft' | 'sealed'): void {
  writeFileSync(join(root, '.workflow', 'sessions', 's-v3', 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 1,
    artifacts: {
      [artifactId]: {
        kind: 'task-input', role: 'primary', producer_run_id: 'producer-run',
        relative_path: 'runs/producer-run/outputs/input.json', media_type: 'application/json',
        schema_version: 'task-input/1.0', content_hash: 'a'.repeat(64), size: 2,
        status, derived_from: [], replaces: null,
      },
    },
    aliases: {},
  }, null, 2)}\n`);
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

describe('formal session/3.0 Commander modules', () => {
  it('marks STORE_BUSY errors retryable in the 1.2 envelope', () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    emitV3Error('session-status', new Error('SessionStore locked by another process'), { session: 's-v3' });
    expect(writes).toHaveLength(1);
    expect(runResponseV12Schema.parse(JSON.parse(writes[0]))).toMatchObject({
      ok: false, error: { code: 'STORE_BUSY', retryable: true },
    });
  });

  it('resolves the unique open Session when --session is omitted', async () => {
    const root = fixture();
    const response = await invoke(registerSessionV3Command, [
      'session', 'status', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-status', ok: true,
      locator: { session_id: 's-v3' },
      result: { schema_version: 'session/3.0', session_id: 's-v3', status: 'open' },
    });
  });

  it('fails closed with stable candidates when --session is omitted and multiple Sessions are open', async () => {
    const root = fixture();
    const firstPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const secondDir = join(root, '.workflow', 'sessions', 's-v3-b');
    const second = JSON.parse(readFileSync(firstPath, 'utf8')) as SessionStateV30;
    mkdirSync(secondDir, { recursive: true });
    writeFileSync(join(secondDir, 'session.json'), `${JSON.stringify({
      ...second, session_id: 's-v3-b', objective: 'second open Session',
    }, null, 2)}\n`);

    const response = await invoke(registerSessionV3Command, [
      'session', 'status', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-status', ok: false,
      error: {
        code: 'SESSION_AMBIGUOUS',
        details: {
          context_error_code: 'SESSION_AMBIGUOUS', source: 'open_sessions',
          candidates: ['s-v3', 's-v3-b'],
        },
        next_actions: ['select-session:s-v3', 'select-session:s-v3-b'],
      },
    });
  });

  it('opens and replays a new Session with canonical registries and receipts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-v3-open-'));
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      session_schema: { schema_version: 'session-schema-selection/1.0', writer: 'session/3.0', features: { session_statusless: false } },
    }));
    const argv = [
      'session', 'open', 'new objective', '--id', 's-open', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-open', '--reason', 'open test', '--json', '--workflow-root', root,
    ];
    const applied = await invoke(registerSessionV3Command, argv);
    vi.restoreAllMocks();
    const replayed = await invoke(registerSessionV3Command, argv);
    expect(applied).toMatchObject({ operation: 'session-open', ok: true, replay: { status: 'applied' } });
    expect(replayed).toMatchObject({ operation: 'session-open', ok: true, replay: { status: 'replayed' } });
    const dir = join(root, '.workflow', 'sessions', 's-open');
    expect(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))).toMatchObject({
      schema_version: 'session/3.0', orchestration_revision: 1, activity_revision: 1,
    });
    expect(JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'))).toMatchObject({ records: {} });
    expect(existsSync(join(dir, 'gates.json'))).toBe(false);
  });

  it('rejects differing participant and actor identities before a v3 mutation', async () => {
    const root = fixture();
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const response = await invoke(registerSessionV3Command, [
      'session', 'archive', '--session', 's-v3',
      '--participant', 'participant', '--actor', 'actor',
      '--request-id', 'req-mismatch', '--reason', 'negative identity test',
      '--expected-orchestration-revision', '0', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-archive', ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.stringContaining('--participant must equal --actor') },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });

  it('rejects session open when participant and actor differ', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-v3-open-mismatch-'));
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      session_schema: { schema_version: 'session-schema-selection/1.0', writer: 'session/3.0', features: { session_statusless: false } },
    }));
    const response = await invoke(registerSessionV3Command, [
      'session', 'open', 'rejected objective', '--id', 's-rejected',
      '--participant', 'participant', '--actor', 'actor',
      '--request-id', 'req-open-mismatch', '--reason', 'negative identity test',
      '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-open', ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.stringContaining('--participant must equal --actor') },
    });
    expect(existsSync(join(root, '.workflow', 'sessions', 's-rejected'))).toBe(false);
  });

  it('resolves the unique open Session when --session is omitted on a mutation', async () => {
    const root = fixture();
    const response = await invoke(registerRunV3Command, [
      'run', 'next', '--run', 'run-no-session', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-no-session', '--reason', 'locator default test',
      '--expected-orchestration-revision', '0', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'next', ok: true,
      locator: { session_id: 's-v3', run_id: 'run-no-session' },
    });
  });

  it('inserts a chain step and creates its next Run', async () => {
    const root = fixture();
    const inserted = await invoke(registerSessionV3Command, [
      'session', 'chain', 'insert', '--step-id', 'step-2', '--command', 'verify', '--after-step', 'step-1',
      ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(inserted).toMatchObject({ operation: 'session-chain-insert', ok: true });
    vi.restoreAllMocks();
    const nextArgs = [
      'run', 'next', '--run', 'run-next', ...mutationFlags(root, '--expected-orchestration-revision', 1),
    ];
    const next = await invoke(registerRunV3Command, nextArgs);
    expect(next).toMatchObject({ operation: 'next', ok: true, replay: { status: 'applied' } });
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T05:00:00.000Z'));
    const replayedNext = await invoke(registerRunV3Command, nextArgs);
    expect(replayedNext).toMatchObject({ operation: 'next', ok: true, replay: { status: 'replayed' } });
    vi.useRealTimers();
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-next', 'run.json'), 'utf8')))
      .toMatchObject({ step_id: 'step-1', status: 'running', revision: 1 });
    vi.restoreAllMocks();
    const completed = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-next', '--summary', 'done', '--advance', '--expected-orchestration-revision', '2',
      ...mutationFlags(root, '--expected-run-revision', 1),
    ]);
    expect(completed).toMatchObject({ operation: 'complete', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8')))
      .toMatchObject({
        orchestration_revision: 3,
        chain: [{ status: 'completed' }, { status: 'pending', run_ids: [] }],
      });
  });

  it('exposes active Run block and evidence-backed fail transitions', async () => {
    const root = fixture({ stepStatus: 'running', run: {
      status: 'running', started_at: '2026-08-12T00:01:00.000Z',
    } });
    const blocked = await invoke(registerRunV3Command, [
      'run', 'transition', 'run-1', 'blocked',
      ...mutationFlags(root, '--expected-run-revision'),
    ]);
    expect(blocked).toMatchObject({ operation: 'run-transition', ok: true, result: { status: 'blocked' } });
    vi.restoreAllMocks();
    const failed = await invoke(registerRunV3Command, [
      'run', 'transition', 'run-1', 'failed', '--expected-orchestration-revision', '0',
      ...mutationFlags(root, '--expected-run-revision', 1),
    ]);
    expect(failed).toMatchObject({
      operation: 'run-transition', ok: true,
      result: { status: 'failed', continuation: { operation: 'check' } },
    });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json'), 'utf8')))
      .toMatchObject({ status: 'failed', revision: 2, verdict: 'needs_retry' });
  });

  it('preserves each requested operation in retired Execution errors', async () => {
    const root = fixture();
    for (const [path, operation] of [
      [['handoff', 'prepare'], 'execution-handoff-prepare'],
      [['operation', 'claim'], 'execution-operation-claim'],
      [['operation', 'heartbeat'], 'execution-operation-heartbeat'],
      [['operation', 'release'], 'execution-operation-release'],
      [['operation', 'status'], 'execution-operation-status'],
    ] as const) {
      const response = await invoke(registerExecutionV3RetiredCommand, [
        'execution', ...path, '--session', 's-v3', '--request-id', `req-retired-${operation}`,
        '--json', '--workflow-root', root,
      ]);
      expect(response).toMatchObject({
        operation, ok: false, error: { code: 'SESSION_SCHEMA_UNSUPPORTED' },
      });
      vi.restoreAllMocks();
    }
  });

  it('seals a completed Run and removes it from active Runs', async () => {
    const root = fixture({ stepStatus: 'completed', run: {
      status: 'completed', revision: 2, ended_at: '2026-08-12T00:02:00.000Z', verdict: 'done', summary: 'done',
    } });
    const response = await invoke(registerRunV3Command, [
      'run', 'seal', 'run-1', ...mutationFlags(root, '--expected-run-revision', 2),
    ]);
    expect(response).toMatchObject({ operation: 'run-seal', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8')))
      .toMatchObject({ active_run_ids: [], activity_revision: 1 });
  });

  it('keeps run seal as terminal-record recovery and refuses a running Run', async () => {
    const root = fixture({ stepStatus: 'running', run: {
      status: 'running', started_at: '2026-08-12T00:01:00.000Z',
    } });
    const beforeArtifacts = readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'artifacts.json'), 'utf8');
    const response = await invoke(registerRunV3Command, [
      'run', 'seal', 'run-1', ...mutationFlags(root, '--expected-run-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'run-seal', ok: false,
      error: { code: 'INVALID_STATE_TRANSITION' },
    });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json'), 'utf8')))
      .toMatchObject({ status: 'running', revision: 0, output_refs: [] });
    expect(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'artifacts.json'), 'utf8')).toBe(beforeArtifacts);
  });

  it('creates and starts a Run through the mutation engine', async () => {
    const root = fixture();
    const createArgs = [
      'run', 'create', 'implement', '--run', 'run-new', '--step', 'step-1',
      ...mutationFlags(root, '--expected-orchestration-revision'),
    ];
    const response = await invoke(registerRunV3Command, createArgs);
    expect(response).toMatchObject({ operation: 'create', ok: true, replay: { status: 'applied' } });
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T06:00:00.000Z'));
    const replayed = await invoke(registerRunV3Command, createArgs);
    expect(replayed).toMatchObject({ operation: 'create', ok: true, replay: { status: 'replayed' } });
    vi.useRealTimers();
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-new', 'run.json'), 'utf8')))
      .toMatchObject({ schema_version: 'run/3.0', status: 'running', revision: 1 });
  });

  it('requires --advance before completing a running Run', async () => {
    const root = fixture({ stepStatus: 'running', run: { status: 'running', started_at: '2026-08-12T00:01:00.000Z' } });
    const response = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-1', '--summary', 'done',
      '--expected-orchestration-revision', '0',
      ...mutationFlags(root, '--expected-run-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'complete', ok: false,
      error: { message: expect.stringContaining('requires --advance') },
    });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8')))
      .toMatchObject({ orchestration_revision: 0, active_run_ids: ['run-1'], chain: [{ status: 'running' }] });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json'), 'utf8')))
      .toMatchObject({ status: 'running', revision: 0 });
  });

  it('run check is read-only and omits knowledge_reconciliation without a receipt', async () => {
    const root = fixture({ run: {} });
    const response = await invoke(registerRunV3Command, [
      'run', 'check', 'run-1', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'check', ok: true,
      result: {
        run_id: 'run-1', status: 'pending', revision: 0,
        available_transitions: ['running', 'cancelled'],
      },
    });
    const result = response.result as Record<string, unknown>;
    expect(result.knowledge_reconciliation).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.completion_preflight).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([
        expect.stringContaining('summary is required'),
        expect.stringContaining('cannot be completed'),
      ]),
      summary_source: null,
    });
    expect(existsSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'knowledge-reconciliation.json'))).toBe(false);
  });

  it('run check reports a ready completion preflight from report summary', async () => {
    const root = fixture({ stepStatus: 'running', run: { status: 'running', started_at: '2026-08-12T00:01:00.000Z' } });
    writeFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'report.md'), '---\nsummary: report summary\n---\n');
    const response = await invoke(registerRunV3Command, [
      'run', 'check', 'run-1', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'check', ok: true,
      result: {
        completion_preflight: { ready: true, blockers: [], summary_source: 'report' },
      },
    });
  });

  it('completes and seals a running Run and its chain step atomically with --advance', async () => {
    const root = fixture({ stepStatus: 'running', run: { status: 'running', started_at: '2026-08-12T00:01:00.000Z' } });
    const response = await invoke(registerRunV3Command, [
      'run', 'complete', 'run-1', '--summary', 'done', '--advance',
      '--expected-orchestration-revision', '0',
      ...mutationFlags(root, '--expected-run-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'complete', ok: true,
      result: {
        operation: 'run-complete-and-seal', status: 'sealed',
        artifact_publication: { authority: 'transition-receipt/2.0', artifact_ids: [] },
        next: {
          suggest_only: true,
          command: 'maestro session complete --session s-v3 --actor <actor-id> --expected-orchestration-revision 1 --json',
        },
        continuation: {
          operation: 'session-complete', locator: { session_id: 's-v3', run_id: null },
          revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
          required_caller_fields: ['actor'],
        },
      },
    });
    const session = JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8'));
    const run = JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json'), 'utf8'));
    expect(session).toMatchObject({ orchestration_revision: 1, active_run_ids: [], chain: [{ status: 'completed' }] });
    expect(run).toMatchObject({
      status: 'sealed', revision: 1, verdict: 'done', summary: 'done',
      ended_at: expect.any(String), sealed_at: expect.any(String),
    });

    vi.restoreAllMocks();
    const brief = await invoke(registerRunV3Command, [
      'run', 'brief', 'run-1', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(brief).toMatchObject({
      operation: 'brief', ok: true,
      result: {
        run: { run_id: 'run-1', status: 'sealed', revision: 1 },
        next: {
          command: 'maestro session complete --session s-v3 --actor <actor-id> --expected-orchestration-revision 1 --json',
        },
        continuation: {
          operation: 'session-complete',
          revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: null },
        },
      },
    });
  });

  it('derives retry attempt metadata instead of accepting a caller attempt', async () => {
    const root = fixture({ stepStatus: 'failed', run: {
      status: 'failed', attempt: 3, revision: 2, ended_at: '2026-08-12T00:02:00.000Z', verdict: 'needs_retry',
    } });
    const response = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', '--run', 'run-retry', '--step', 'step-1', '--retry-of-run', 'run-1',
      ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({ operation: 'create', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-retry', 'run.json'), 'utf8')))
      .toMatchObject({ retry_of_run_id: 'run-1', attempt: 4, status: 'running' });

    const program = new Command();
    registerRunV3Command(program);
    const create = program.commands.find(command => command.name() === 'run')
      ?.commands.find(command => command.name() === 'create');
    expect(create?.options.map(option => option.long)).not.toContain('--attempt');
  });

  it('cancels a pending Run through the mutation engine', async () => {
    const root = fixture({ run: {} });
    const response = await invoke(registerRunV3Command, [
      'run', 'cancel', 'run-1', ...mutationFlags(root, '--expected-run-revision'),
      '--expected-orchestration-revision', '0',
    ]);
    expect(response).toMatchObject({
      operation: 'run-cancel', ok: true,
      result: {
        continuation: {
          operation: 'next',
          revision_requirements: { expected_orchestration_revision: 0, expected_run_revision: null },
        },
      },
    });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', 'run-1', 'run.json'), 'utf8')))
      .toMatchObject({ status: 'cancelled', revision: 1 });
  });

  it('requires an orchestration fence for Run cancellation', async () => {
    const root = fixture({ run: {} });
    const program = new Command().name('maestro').exitOverride().configureOutput({ writeErr: () => {} });
    registerRunV3Command(program);
    await expect(program.parseAsync([
      'node', 'maestro', 'run', 'cancel', 'run-1',
      ...mutationFlags(root, '--expected-run-revision'),
    ])).rejects.toThrow(/required option '--expected-orchestration-revision <n>'/);
  });

  it('returns RUN_NOT_FOUND without leaking storage paths', async () => {
    const root = fixture();
    const cancelled = await invoke(registerRunV3Command, [
      'run', 'cancel', 'missing-run', ...mutationFlags(root, '--expected-run-revision'),
      '--expected-orchestration-revision', '0',
    ]);
    expect(cancelled).toMatchObject({
      operation: 'run-cancel', ok: false,
      error: { code: 'RUN_NOT_FOUND', message: 'Run missing-run was not found' },
    });
    expect(cancelled.error?.message).not.toContain(root);

    vi.restoreAllMocks();
    const checked = await invoke(registerRunV3Command, [
      'run', 'check', 'missing-run', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(checked).toMatchObject({
      operation: 'check', ok: false,
      error: { code: 'RUN_NOT_FOUND', message: 'Run missing-run was not found' },
    });
  });

  it('projects an empty blocking gate set and draft publications from authoritative registries', async () => {
    const root = fixture();
    const sessionDir = join(root, '.workflow', 'sessions', 's-v3');
    writeFileSync(join(sessionDir, 'artifacts.json'), `${JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 4,
      artifacts: {
        'publication-draft': {
          kind: 'report', role: 'primary', producer_run_id: 'run-source', relative_path: 'outputs/draft.md',
          media_type: 'text/markdown', schema_version: 'report/1.0', content_hash: 'a'.repeat(64),
          size: 12, status: 'draft', derived_from: [], replaces: null,
        },
      },
      aliases: {},
    }, null, 2)}\n`);
    const response = await invoke(registerSessionV3Command, [
      'session', 'resume-view', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-resume-view', ok: true,
      result: {
        blockingGates: [],
        pendingPublications: [{ publicationId: 'publication-draft', resourceUri: 'outputs/draft.md' }],
      },
    });
  });

  it('completes a satisfied Session and exposes all read commands', async () => {
    const root = fixture({ stepStatus: 'completed', run: { status: 'sealed', revision: 2, ended_at: '2026-08-12T00:02:00.000Z', sealed_at: '2026-08-12T00:03:00.000Z' } });
    const response = await invoke(registerSessionV3Command, [
      'session', 'complete', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({ operation: 'session-complete', ok: true });

    vi.restoreAllMocks();
    const program = new Command();
    registerSessionV3Command(program);
    registerRunV3Command(program);
    expect(program.commands.find(command => command.name() === 'session')?.commands.map(command => command.name()))
      .toEqual(expect.arrayContaining(['open', 'migrate', 'complete', 'status', 'resume-view', 'archive', 'unarchive', 'chain']));
    expect(program.commands.find(command => command.name() === 'run')?.commands.map(command => command.name()))
      .toEqual(expect.arrayContaining(['next', 'create', 'transition', 'complete', 'cancel', 'seal', 'brief', 'check']));
  });

  it('opens a Session with a generated pending chain when --chain is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-v3-open-chain-'));
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      session_schema: { schema_version: 'session-schema-selection/1.0', writer: 'session/3.0', features: { session_statusless: false } },
    }));
    const chained = await invoke(registerSessionV3Command, [
      'session', 'open', 'chain objective', '--id', 's-chain', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-chain', '--reason', 'chain test', '--chain', 'build', 'test', 'ship',
      '--json', '--workflow-root', root,
    ]);
    expect(chained).toMatchObject({ operation: 'session-open', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-chain', 'session.json'), 'utf8')))
      .toMatchObject({ chain: [
        { step_id: 's-1', command: 'build', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [], stage: null },
        { step_id: 's-2', command: 'test', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [], stage: null },
        { step_id: 's-3', command: 'ship', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [], stage: null },
      ] });

    vi.restoreAllMocks();
    const enriched = await invoke(registerSessionV3Command, [
      'session', 'chain', 'update', '--session', 's-chain', '--step-id', 's-1',
      '--arg', 'domain', '--arg=--strict', '--goal-ref', 'goal-build', '--stage', 'build',
      '--decision-ref', 'gate-build', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-chain-update', '--reason', 'enrich seeded step',
      '--expected-orchestration-revision', '1', '--json', '--workflow-root', root,
    ]);
    expect(enriched).toMatchObject({
      operation: 'session-chain-update', ok: true,
      revision: { target_type: 'orchestration', target_id: 's-chain', revision: 2 },
    });
    const enrichedState = JSON.parse(
      readFileSync(join(root, '.workflow', 'sessions', 's-chain', 'session.json'), 'utf8'),
    );
    expect(enrichedState).toMatchObject({
      orchestration_revision: 2,
      decisions: [{ decision_id: 'gate-build', after_step_id: 's-1', status: 'open', evidence_refs: [] }],
    });
    expect(enrichedState.chain[0]).toMatchObject({
      step_id: 's-1', command: 'build', args: ['domain', '--strict'], goal_ref: 'goal-build',
      stage: 'build', decision_ref: 'gate-build', status: 'pending',
    });
    vi.restoreAllMocks();
    const preserved = await invoke(registerSessionV3Command, [
      'session', 'chain', 'update', '--session', 's-chain', '--step-id', 's-1', '--command', 'compile',
      '--participant', 'actor', '--actor', 'actor', '--request-id', 'req-chain-update-command',
      '--reason', 'change only command', '--expected-orchestration-revision', '2',
      '--json', '--workflow-root', root,
    ]);
    expect(preserved).toMatchObject({ operation: 'session-chain-update', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-chain', 'session.json'), 'utf8'))
      .chain[0]).toMatchObject({
        command: 'compile', args: ['domain', '--strict'], goal_ref: 'goal-build',
        stage: 'build', decision_ref: 'gate-build',
      });

    vi.restoreAllMocks();
    const plain = await invoke(registerSessionV3Command, [
      'session', 'open', 'plain objective', '--id', 's-plain', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-plain', '--reason', 'plain test', '--json', '--workflow-root', root,
    ]);
    expect(plain).toMatchObject({ operation: 'session-open', ok: true });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-plain', 'session.json'), 'utf8')))
      .toMatchObject({ chain: [] });
  });

  it('lists v3 Sessions sorted by updated_at descending and skips non-v3 entries', async () => {
    const root = fixture();
    const sessionDir = join(root, '.workflow', 'sessions');
    const second = JSON.parse(readFileSync(join(sessionDir, 's-v3', 'session.json'), 'utf8')) as SessionStateV30;
    mkdirSync(join(sessionDir, 's-v3-b'), { recursive: true });
    writeFileSync(join(sessionDir, 's-v3-b', 'session.json'), `${JSON.stringify({
      ...second, session_id: 's-v3-b', objective: 'second Session',
      active_run_ids: ['run-b'], updated_at: '2026-08-12T03:00:00.000Z',
    }, null, 2)}\n`);
    mkdirSync(join(sessionDir, 's-v2'), { recursive: true });
    writeFileSync(join(sessionDir, 's-v2', 'session.json'), `${JSON.stringify({
      schema_version: 'session/2.0', session_id: 's-v2', intent: 'legacy',
    }, null, 2)}\n`);

    const response = await invoke(registerSessionV3Command, [
      'session', 'list', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({ operation: 'session-list', ok: true, locator: { session_id: null } });
    expect(response.result).toEqual([
      { session_id: 's-v3-b', status: 'open', objective: 'second Session', orchestration_revision: 0, activity_revision: 0, active_run_ids: ['run-b'], updated_at: '2026-08-12T03:00:00.000Z' },
      { session_id: 's-v3', status: 'open', objective: 'exercise CLI', orchestration_revision: 0, activity_revision: 0, active_run_ids: [], updated_at: '2026-08-12T00:00:00.000Z' },
    ]);
  });

  it('returns an empty list for a workspace without sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-v3-list-empty-'));
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      session_schema: { schema_version: 'session-schema-selection/1.0', writer: 'session/3.0', features: { session_statusless: false } },
    }));
    const response = await invoke(registerSessionV3Command, [
      'session', 'list', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({ operation: 'session-list', ok: true });
    expect(response.result).toEqual([]);
  });

  it('recalls v3 Sessions by objective, definition_of_done, and chain command read-only', async () => {
    const root = fixture();
    const sessionDir = join(root, '.workflow', 'sessions');
    const second = JSON.parse(readFileSync(join(sessionDir, 's-v3', 'session.json'), 'utf8')) as SessionStateV30;
    mkdirSync(join(sessionDir, 's-impl'), { recursive: true });
    writeFileSync(join(sessionDir, 's-impl', 'session.json'), `${JSON.stringify({
      ...second, session_id: 's-impl', objective: 'implement the widget', definition_of_done: 'verified',
      chain: [{ step_id: 'step-1', command: 'verify', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] }],
      updated_at: '2026-08-12T01:00:00.000Z',
    }, null, 2)}\n`);
    mkdirSync(join(sessionDir, 's-deploy'), { recursive: true });
    writeFileSync(join(sessionDir, 's-deploy', 'session.json'), `${JSON.stringify({
      ...second, session_id: 's-deploy', objective: 'unrelated topic', definition_of_done: 'nothing in common',
      chain: [{ step_id: 'step-1', command: 'deploy', args: [], status: 'pending', run_ids: [], goal_ref: null, decision_refs: [] }],
      updated_at: '2026-08-12T02:00:00.000Z',
    }, null, 2)}\n`);

    const before = readFileSync(join(sessionDir, 's-v3', 'session.json'), 'utf8');
    const byObjective = await invoke(registerRunV3Command, [
      'run', 'recall', 'implement', '--json', '--workflow-root', root,
    ]);
    expect(byObjective).toMatchObject({ operation: 'recall', ok: true, locator: { session_id: null } });
    expect(byObjective.result).toEqual([
      { session_id: 's-impl', status: 'open', objective: 'implement the widget', updated_at: '2026-08-12T01:00:00.000Z', matched: ['implement the widget'] },
      { session_id: 's-v3', status: 'open', objective: 'exercise CLI', updated_at: '2026-08-12T00:00:00.000Z', matched: ['implement'] },
    ]);
    vi.restoreAllMocks();
    const byDefinition = await invoke(registerRunV3Command, [
      'run', 'recall', 'persist', '--json', '--workflow-root', root,
    ]);
    expect(byDefinition.result).toEqual([
      { session_id: 's-v3', status: 'open', objective: 'exercise CLI', updated_at: '2026-08-12T00:00:00.000Z', matched: ['commands persist atomically'] },
    ]);
    expect(readFileSync(join(sessionDir, 's-v3', 'session.json'), 'utf8')).toBe(before);
  });

  it('inserts a chain step with goal reference and stage metadata', async () => {
    const root = fixture();
    const response = await invoke(registerSessionV3Command, [
      'session', 'chain', 'insert', '--step-id', 'step-2', '--command', 'verify',
      '--goal-ref', 'goal-7', '--stage', 'release', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({ operation: 'session-chain-insert', ok: true });
    const state = JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8')) as SessionStateV30;
    expect(state.chain[1]).toMatchObject({ step_id: 'step-2', command: 'verify', goal_ref: 'goal-7', stage: 'release' });
  });

  it('rejects stale and non-pending chain updates without changing the Session', async () => {
    for (const testCase of [
      { name: 'stale', fixture: {}, revision: 7, code: 'ORCHESTRATION_REVISION_CONFLICT' },
      { name: 'running', fixture: { stepStatus: 'running' as const }, revision: 0, code: 'INVALID_STATE_TRANSITION' },
    ]) {
      const root = fixture(testCase.fixture);
      const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
      const before = readFileSync(sessionPath, 'utf8');
      const response = await invoke(registerSessionV3Command, [
        'session', 'chain', 'update', '--step-id', 'step-1', '--stage', 'review',
        ...mutationFlags(root, '--expected-orchestration-revision', testCase.revision),
      ]);
      expect(response).toMatchObject({
        operation: 'session-chain-update', ok: false, error: { code: testCase.code },
      });
      expect(readFileSync(sessionPath, 'utf8')).toBe(before);
      vi.restoreAllMocks();
    }
  });

  it('preserves task args, goal, and sealed same-Session inputs across create and brief', async () => {
    const root = fixture();
    writeInputArtifact(root, 'ART-input', 'sealed');
    const response = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', 'domain-text', 'strict-mode',
      '--run', 'run-created', '--step', 'step-1', '--goal', 'deliver exact contract',
      '--input', 'ART-input', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'create', ok: true,
      result: {
        run_id: 'run-created', status: 'running', revision: 1,
        task: {
          command: 'implement', args: ['domain-text', 'strict-mode'],
          goal: 'deliver exact contract', input_refs: ['ART-input'],
        },
        next: { suggest_only: true, command: expect.any(String) },
        continuation: {
          operation: 'complete', locator: { session_id: 's-v3', run_id: 'run-created' },
          revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: 1 },
          required_caller_fields: ['actor'],
        },
      },
    });
    expect((response.result as any).next.command).toBe(
      'maestro run complete run-created --session s-v3 --actor <actor-id> '
      + '--expected-run-revision 1 '
      + '--expected-orchestration-revision 1 --verdict done --advance --json',
    );
    expect(new SessionStore(root).readRunV30('s-v3', 'run-created')).toMatchObject({
      command: 'implement', args: ['domain-text', 'strict-mode'],
      goal: 'deliver exact contract', input_refs: ['ART-input'],
    });

    vi.restoreAllMocks();
    const brief = await invoke(registerRunV3Command, [
      'run', 'brief', 'run-created', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(brief).toMatchObject({
      operation: 'brief', ok: true,
      result: {
        run: {
          command: 'implement', args: ['domain-text', 'strict-mode'],
          goal: 'deliver exact contract', input_refs: ['ART-input'],
        },
        task: {
          command: 'implement', args: ['domain-text', 'strict-mode'],
          goal: 'deliver exact contract', input_refs: ['ART-input'],
        },
        brief: { command: 'maestro run brief run-created --session s-v3 --json' },
      },
    });
  });

  it.each([
    ['unknown', 'ART-unknown'],
    ['unsealed', 'ART-draft'],
  ])('rejects %s explicit input refs without committing the Run', async (kind, artifactId) => {
    const root = fixture();
    if (kind === 'unsealed') writeInputArtifact(root, artifactId, 'draft');
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const response = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', '--run', `run-${kind}`, '--step', 'step-1',
      '--input', artifactId, ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'create', ok: false,
      error: { message: expect.stringContaining(`explicit input Artifact ${artifactId}`) },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
    expect(existsSync(join(root, '.workflow', 'sessions', 's-v3', 'runs', `run-${kind}`, 'run.json'))).toBe(false);
  });

  it('preserves chain task args and goal in run next', async () => {
    const root = fixture();
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const state = JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionStateV30;
    state.chain[0].args = ['domain-next', '--verify'];
    state.chain[0].goal_ref = 'goal-next';
    writeFileSync(sessionPath, `${JSON.stringify(state, null, 2)}\n`);
    const response = await invoke(registerRunV3Command, [
      'run', 'next', '--run', 'run-next-task', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'next', ok: true,
      result: {
        task: { command: 'implement', args: ['domain-next', '--verify'], goal: 'goal-next', input_refs: [] },
      },
    });
  });

  it('appends step_id and an executable next contract to the run next result', async () => {
    const root = fixture();
    const response = await invoke(registerRunV3Command, [
      'run', 'next', '--run', 'run-next', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'next', ok: true,
      result: {
        run_id: 'run-next', status: 'running', revision: 1,
        step_id: 'step-1',
        next: {
          suggest_only: true,
          command: 'maestro run complete run-next --session s-v3 --actor <actor-id> --expected-run-revision 1 --expected-orchestration-revision 1 --verdict done --advance --json',
          reason: 'Run created - execute and complete it with run complete --advance',
        },
        continuation: {
          operation: 'complete', locator: { session_id: 's-v3', run_id: 'run-next' },
          revision_requirements: { expected_orchestration_revision: 1, expected_run_revision: 1 },
          required_caller_fields: ['actor'],
        },
      },
    });
  });
});

function writeLegacySession(root: string, sessionId: string, intent: string): void {
  const dir = join(root, '.workflow', 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gates.json'), `${JSON.stringify({
    schema_version: 'gates/1.0', revision: 0, gates: {},
    summary: { total: 0, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null },
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify({
    schema_version: 'evidence/1.0', revision: 0, records: {},
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify(createSessionState(sessionId, intent), null, 2)}\n`);
}

function writeUnmigratableSession(root: string, sessionId: string): void {
  const dir = join(root, '.workflow', 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify({
    schema_version: 'session/9.9', session_id: sessionId, intent: 'unmigratable',
  }, null, 2)}\n`);
}

function archiveFixture(root: string): string {
  const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
  const state = JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionStateV30;
  writeFileSync(sessionPath, `${JSON.stringify({
    ...state, status: 'archived', archived_at: '2026-08-12T02:00:00.000Z',
  }, null, 2)}\n`);
  return sessionPath;
}

describe('session migrate', () => {
  function singleMigrationFlags(root: string, sessionId: string, identityRevision = 1, activityRevision = 0): string[] {
    return [
      '--session', sessionId, '--to-v3', '--participant', 'actor', '--actor', 'actor',
      '--request-id', `req-migrate-${sessionId}`, '--reason', 'focused migration',
      '--expected-identity-revision', String(identityRevision),
      '--expected-activity-revision', String(activityRevision),
      '--json', '--workflow-root', root,
    ];
  }

  it('requires both caller legacy revisions and preserves already-applied reads', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const args = ['session', 'migrate', ...singleMigrationFlags(root, 's-legacy')];
    const applied = await invoke(registerSessionV3Command, args);
    expect(applied).toMatchObject({ operation: 'session-migrate', ok: true, result: { status: 'applied' } });
    vi.restoreAllMocks();
    const replayed = await invoke(registerSessionV3Command, args);
    expect(replayed).toMatchObject({ operation: 'session-migrate', ok: true, result: { status: 'already-applied' } });
  });

  it('requires both legacy revisions for a single migration without mutating the Session', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const sessionPath = join(root, '.workflow', 'sessions', 's-legacy', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const flags = singleMigrationFlags(root, 's-legacy');
    flags.splice(flags.indexOf('--expected-activity-revision'), 2);
    const response = await invoke(registerSessionV3Command, ['session', 'migrate', ...flags]);
    expect(response).toMatchObject({
      operation: 'session-migrate', ok: false,
      error: { message: expect.stringContaining('--expected-activity-revision is required with --session') },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });

  it('rejects a stale single migration fence without mutating the legacy Session', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const sessionPath = join(root, '.workflow', 'sessions', 's-legacy', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', ...singleMigrationFlags(root, 's-legacy', 1, 99),
    ]);
    expect(response).toMatchObject({
      operation: 'session-migrate', ok: false,
      error: { message: expect.stringContaining('activity revision conflict') },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });

  it('rejects differing migration participant and actor without mutating the legacy Session', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const sessionPath = join(root, '.workflow', 'sessions', 's-legacy', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const flags = singleMigrationFlags(root, 's-legacy');
    flags[flags.indexOf('--participant') + 1] = 'other-participant';
    const response = await invoke(registerSessionV3Command, ['session', 'migrate', ...flags]);
    expect(response).toMatchObject({
      operation: 'session-migrate', ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.stringContaining('--participant must equal --actor') },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });
});

describe('session migrate --all', () => {
  const migrateAllFlags = (
    root: string,
    expectedRevisions: Record<string, { identity_revision: number; activity_revision: number }>,
  ): string[] => [
    '--to-v3', '--participant', 'actor', '--actor', 'actor',
    '--request-id', 'req-migrate-all', '--reason', 'focused batch migration',
    '--expected-revisions', JSON.stringify(expectedRevisions), '--json', '--workflow-root', root,
  ];

  it('migrates every non-v3 Session and skips already-v3 Sessions', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', '--all', ...migrateAllFlags(root, {
        's-legacy': { identity_revision: 1, activity_revision: 0 },
      }),
    ]);
    expect(response).toMatchObject({ operation: 'session-migrate', ok: true, locator: { session_id: null } });
    expect(response.result).toEqual([
      { session_id: 's-legacy', source_schema_version: 'session/1.3', outcome: 'migrated' },
    ]);
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-legacy', 'session.json'), 'utf8')))
      .toMatchObject({ schema_version: 'session/3.0', session_id: 's-legacy' });
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-v3', 'session.json'), 'utf8')))
      .toMatchObject({ schema_version: 'session/3.0', session_id: 's-v3', status: 'open' });
  });

  it('records a per-Session failure without interrupting the batch', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    writeUnmigratableSession(root, 's-bad');
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', '--all', ...migrateAllFlags(root, {
        's-bad': { identity_revision: 0, activity_revision: 0 },
        's-legacy': { identity_revision: 1, activity_revision: 0 },
      }),
    ]);
    expect(response).toMatchObject({ operation: 'session-migrate', ok: true });
    expect(response.result).toEqual([
      { session_id: 's-bad', source_schema_version: 'session/9.9', outcome: 'failed',
        error: expect.stringContaining('cannot migrate from session/9.9') },
      { session_id: 's-legacy', source_schema_version: 'session/1.3', outcome: 'migrated' },
    ]);
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-legacy', 'session.json'), 'utf8')))
      .toMatchObject({ schema_version: 'session/3.0' });
  });

  it('fails missing and mismatched batch candidates independently without mutating them', async () => {
    const root = fixture();
    writeLegacySession(root, 's-good', 'good legacy objective');
    writeLegacySession(root, 's-missing', 'missing legacy fence');
    writeLegacySession(root, 's-stale', 'stale legacy fence');
    const missingPath = join(root, '.workflow', 'sessions', 's-missing', 'session.json');
    const stalePath = join(root, '.workflow', 'sessions', 's-stale', 'session.json');
    const missingBefore = readFileSync(missingPath, 'utf8');
    const staleBefore = readFileSync(stalePath, 'utf8');
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', '--all', ...migrateAllFlags(root, {
        's-good': { identity_revision: 1, activity_revision: 0 },
        's-stale': { identity_revision: 99, activity_revision: 0 },
      }),
    ]);
    expect(response).toMatchObject({ operation: 'session-migrate', ok: true });
    expect(response.result).toEqual([
      { session_id: 's-good', source_schema_version: 'session/1.3', outcome: 'migrated' },
      { session_id: 's-missing', source_schema_version: 'session/1.3', outcome: 'failed',
        error: expect.stringContaining('expected revisions missing') },
      { session_id: 's-stale', source_schema_version: 'session/1.3', outcome: 'failed',
        error: expect.stringContaining('identity revision conflict') },
    ]);
    expect(readFileSync(missingPath, 'utf8')).toBe(missingBefore);
    expect(readFileSync(stalePath, 'utf8')).toBe(staleBefore);
    expect(JSON.parse(readFileSync(join(root, '.workflow', 'sessions', 's-good', 'session.json'), 'utf8')))
      .toMatchObject({ schema_version: 'session/3.0' });
  });

  it('requires an expected revisions manifest for --all', async () => {
    const root = fixture();
    writeLegacySession(root, 's-legacy', 'legacy objective');
    const sessionPath = join(root, '.workflow', 'sessions', 's-legacy', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', '--all', '--to-v3', '--participant', 'actor', '--actor', 'actor',
      '--request-id', 'req-missing-manifest', '--reason', 'negative manifest test',
      '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'session-migrate', ok: false,
      error: { message: expect.stringContaining('--expected-revisions is required with --all') },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });

  it('rejects --all combined with --session as mutually exclusive', async () => {
    const root = fixture();
    const response = await invoke(registerSessionV3Command, [
      'session', 'migrate', '--all', '--session', 's-v3', ...migrateAllFlags(root, {}),
    ]);
    expect(response).toMatchObject({
      operation: 'session-migrate', ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.stringContaining('mutually exclusive') },
    });
  });
});

describe('session unarchive', () => {
  it('moves an archived Session back to open and advances the orchestration revision', async () => {
    const root = fixture();
    const sessionPath = archiveFixture(root);
    const response = await invoke(registerSessionV3Command, [
      'session', 'unarchive', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'session-unarchive', ok: true,
      result: { status: 'open', orchestration_revision: 1 },
    });
    expect(JSON.parse(readFileSync(sessionPath, 'utf8'))).toMatchObject({
      status: 'open', orchestration_revision: 1, activity_revision: 1, archived_at: null,
    });
  });

  it('rejects unarchive for a non-archived Session', async () => {
    const root = fixture();
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const before = readFileSync(sessionPath, 'utf8');
    const response = await invoke(registerSessionV3Command, [
      'session', 'unarchive', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(response).toMatchObject({
      operation: 'session-unarchive', ok: false,
      error: { code: 'INVALID_STATE_TRANSITION' },
    });
    expect(readFileSync(sessionPath, 'utf8')).toBe(before);
  });

  it('restores create_run permission after unarchive', async () => {
    const root = fixture();
    archiveFixture(root);
    const before = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', '--run', 'run-before', '--step', 'step-1',
      ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(before).toMatchObject({ operation: 'create', ok: false, error: { code: 'INVALID_STATE_TRANSITION' } });
    vi.restoreAllMocks();
    const unarchive = await invoke(registerSessionV3Command, [
      'session', 'unarchive', ...mutationFlags(root, '--expected-orchestration-revision'),
    ]);
    expect(unarchive).toMatchObject({ operation: 'session-unarchive', ok: true });
    vi.restoreAllMocks();
    const created = await invoke(registerRunV3Command, [
      'run', 'create', 'implement', '--run', 'run-after', '--step', 'step-1',
      ...mutationFlags(root, '--expected-orchestration-revision', 1),
    ]);
    expect(created).toMatchObject({ operation: 'create', ok: true });
  });
});

describe('run/session CLI compatibility', () => {
  it('resolves the unique active Run when brief omits <run-id>', async () => {
    const root = fixture({ stepStatus: 'running', run: { status: 'running', started_at: '2026-08-12T00:01:00.000Z' } });
    const response = await invoke(registerRunV3Command, [
      'run', 'brief', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'brief', ok: true,
      locator: { session_id: 's-v3', run_id: 'run-1' },
    });
  });

  it('resolves the unique active Run when check omits <run-id>', async () => {
    const root = fixture({ run: {} });
    const response = await invoke(registerRunV3Command, [
      'run', 'check', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'check', ok: true,
      result: { run_id: 'run-1' },
    });
  });

  it('requires an explicit <run-id> when the Session has no active Run', async () => {
    const root = fixture();
    const response = await invoke(registerRunV3Command, [
      'run', 'brief', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'brief', ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.stringContaining('pass <run-id> explicitly') },
    });
  });

  it('requires an explicit <run-id> when multiple Runs are active', async () => {
    const root = fixture({ run: {} });
    const sessionPath = join(root, '.workflow', 'sessions', 's-v3', 'session.json');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionStateV30;
    session.active_run_ids = ['run-1', 'run-2'];
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    const response = await invoke(registerRunV3Command, [
      'run', 'check', '--session', 's-v3', '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'check', ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('run-1, run-2'),
      },
    });
  });

  it('lists every missing mandatory option on run complete instead of the first only', async () => {
    const root = fixture({ run: {} });
    const program = new Command().name('maestro').exitOverride().configureOutput({ writeErr: () => {} });
    registerRunV3Command(program);
    await expect(program.parseAsync([
      'node', 'maestro', 'run', 'complete', 'run-1', '--workflow-root', root,
    ])).rejects.toThrow(/'--expected-run-revision <n>'[\s\S]*'--expected-orchestration-revision <n>'[\s\S]*--advance/);
  });

  it.each([
    [['run', 'status'], 'run check'],
    [['run', 'done'], 'run complete'],
    [['run', 'list'], 'session list'],
  ])('routes retired %s to the v3 replacement', async (args, hint) => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
    const program = new Command().name('maestro').exitOverride();
    registerRunV3Command(program);
    await program.parseAsync(['node', 'maestro', ...args]);
    expect(errors.join('\n')).toContain(hint);
    expect(process.exitCode).toBe(1);
  });

  it('routes retired session done to session complete', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
    const program = new Command().name('maestro').exitOverride();
    registerSessionV3Command(program);
    await program.parseAsync(['node', 'maestro', 'session', 'done']);
    expect(errors.join('\n')).toContain('session complete');
    expect(process.exitCode).toBe(1);
  });

  it('defaults mutation identity flags: actor-only invocation derives participant, request-id and reason', async () => {
    const root = fixture({ run: {} });
    const response = await invoke(registerRunV3Command, [
      'run', 'cancel', 'run-1', '--actor', 'devin',
      '--expected-run-revision', '0', '--expected-orchestration-revision', '0',
      '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({
      operation: 'run-cancel', ok: true,
      locator: { session_id: 's-v3', run_id: 'run-1' },
      result: { status: 'cancelled' },
    });
    expect(response.request_id).toMatch(/^cli-[0-9a-f]{16}$/);
    expect((response.result as Record<string, unknown>).summary_line)
      .toBe(`run-cancel ok · session=s-v3 · run=run-1 · rev=1 · req=${response.request_id} · next="maestro run next --session s-v3 --actor <actor-id> --expected-orchestration-revision 0 --json"`);
  });

  it('replays a verbatim retry under the derived request-id instead of duplicating', async () => {
    const root = fixture({ run: {} });
    const args = [
      'run', 'cancel', 'run-1', '--actor', 'devin',
      '--expected-run-revision', '0', '--expected-orchestration-revision', '0',
      '--json', '--workflow-root', root,
    ];
    const first = await invoke(registerRunV3Command, args);
    vi.restoreAllMocks();
    const second = await invoke(registerRunV3Command, args);
    expect(first.request_id).toBe(second.request_id);
    expect(second).toMatchObject({ ok: true, replay: { status: 'replayed' } });
  });

  it('defaults --actor from MAESTRO_ACTOR when no identity flags are passed', async () => {
    const root = fixture({ run: {} });
    vi.stubEnv('MAESTRO_ACTOR', 'env-actor');
    const response = await invoke(registerRunV3Command, [
      'run', 'cancel', 'run-1',
      '--expected-run-revision', '0', '--expected-orchestration-revision', '0',
      '--json', '--workflow-root', root,
    ]);
    expect(response).toMatchObject({ operation: 'run-cancel', ok: true });
    vi.unstubAllEnvs();
  });

  it('fails with a clear error when no actor identity is available', async () => {
    const root = fixture({ run: {} });
    vi.stubEnv('MAESTRO_ACTOR', '');
    const program = new Command().name('maestro').exitOverride().configureOutput({ writeErr: () => {} });
    registerRunV3Command(program);
    await expect(program.parseAsync([
      'node', 'maestro', 'run', 'cancel', 'run-1',
      '--expected-run-revision', '0', '--expected-orchestration-revision', '0',
      '--json', '--workflow-root', root,
    ])).rejects.toThrow(/--actor <id>.*MAESTRO_ACTOR/);
    vi.unstubAllEnvs();
  });
});
