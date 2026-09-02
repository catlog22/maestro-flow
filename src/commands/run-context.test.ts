import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRunCommand } from './run.js';
import { SessionStore } from '../run/store.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

let projectRoot: string;
let logs: string[];
let stderrWrites: string[];

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'maestro-run-cli-context-'));
  v2Workspace(projectRoot);
  logs = [];
  stderrWrites = [];
  vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logs.push(String(value)); });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  const commands = join(projectRoot, '.claude', 'commands');
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, 'cli-context.md'), '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n');
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function program(): Command {
  const value = new Command();
  value.exitOverride();
  registerRunCommand(value);
  return value;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(['node', 'maestro', 'run', ...args]);
}

describe('maestro run durable context CLI', () => {
  it('prints the same persisted context from create and brief', async () => {
    await run('create', 'cli-context', '--session', 's', '--platform', 'codex', '--workflow-root', projectRoot);
    const created = JSON.parse(logs.at(-1)!) as Record<string, unknown>;
    await run('brief', String(created.run_id), '--session', 's', '--workflow-root', projectRoot);
    const brief = JSON.parse(logs.at(-1)!) as Record<string, unknown>;

    expect(created.resolved_platform).toBe('codex');
    expect((brief.run as any).resolved_platform).toBe('codex');
    expect((brief.run as any).run_dir).toBe(created.run_dir);
    expect((brief.run as any).chain_step_id).toBeNull();
  });

  it('removes free-form parent linkage and accepts only retry-token lineage', () => {
    const run = program().commands.find(item => item.name() === 'run');
    const create = run?.commands.find(item => item.name() === 'create');
    expect(create?.options.some(option => option.long === '--parent-run')).toBe(false);
    expect(create?.options.some(option => option.long === '--retry-token')).toBe(true);
    expect(create?.options.some(option => option.long === '--platform')).toBe(true);
    expect(create?.options.find(option => option.long === '--intent')?.description)
      .toBe('Session metadata only (not passed to the command or Run input.args)');
    expect(create?.options.find(option => option.long === '--arg')?.description)
      .toBe('command input stored in Run input.args (repeatable)');
    const help = create?.helpInformation().replace(/\s+/g, ' ');
    expect(help).toContain('--intent <text>');
    expect(help).toContain('not passed to the command');
    expect(help).toContain('command input stored in Run input.args (repeatable)');
  });

  it('starts a chain Session from command names and edits pending steps in place', async () => {
    await run(
      'start',
      '统一 run session',
      '--id',
      'unified',
      '--platform',
      'codex',
      '--workflow-root',
      projectRoot,
      '--no-dispatch',
      '--chain',
      'cli-context',
      'cli-context',
    );
    const started = JSON.parse(logs.at(-1)!) as Record<string, unknown>;
    const sessionId = String(started.session_id);
    expect(sessionId).toMatch(/^unified-\d{8}-\d{6}$/);
    expect(started).not.toHaveProperty('dispatched');

    await run(
      'edit',
      'review',
      'test',
      '--session',
      sessionId,
      '--after',
      'start',
      '--workflow-root',
      projectRoot,
    );
    const edited = JSON.parse(logs.at(-1)!) as { inserted: Array<{ command: string }> };
    expect(edited.inserted.map(step => step.command)).toEqual(['review', 'test']);

    const session = new SessionStore(projectRoot).readBundle(sessionId).session;
    expect(session.active_run_id).toBeNull();
    expect(session.orchestration.chain.map(step => step.command)).toEqual([
      'review',
      'test',
      'cli-context',
      'cli-context',
    ]);
    expect(session.orchestration.executor).toEqual({ platform: 'codex', cli_tool: 'codex' });
  });

  it('owns advanced Session creation, status, and metadata updates under run', async () => {
    const chainFile = join(projectRoot, 'chain.json');
    writeFileSync(chainFile, JSON.stringify({
      intent: 'advanced run chain',
      position: { lifecycle: 'analyze', planning_mode: 'unified', passed_gates: [] },
      decomposition: { execution_criteria: [], goals: [], changelog: [] },
      steps: [{ command: 'cli-context', stage: 'analyze' }],
    }));
    await run('start', '--id', 'advanced', '--chain-file', chainFile, '--no-dispatch', '--workflow-root', projectRoot);
    const sessionId = String((JSON.parse(logs.at(-1)!) as any).session_id);

    await run('status', sessionId, '--workflow-root', projectRoot);
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ session_id: sessionId, status: 'running' });

    const decompositionFile = join(projectRoot, 'decomposition.json');
    writeFileSync(decompositionFile, JSON.stringify({
      execution_criteria: ['tests pass'],
      goals: [],
      changelog: [],
    }));
    await run('edit', '--session', sessionId, '--decomposition-file', decompositionFile, '--workflow-root', projectRoot);
    expect(new SessionStore(projectRoot).readBundle(sessionId).session.orchestration.decomposition.execution_criteria)
      .toEqual(['tests pass']);
  });

  it('projects paused recovery blockers and accepts repeatable evidence for resume', async () => {
    const store = new SessionStore(projectRoot);
    store.createSession('paused-status', 'paused recovery', { ifExists: 'error' });
    store.update('paused-status', draft => {
      draft.session.status = 'paused';
      draft.session.orchestration.chain = [{
        step_id: 'step-000-failed', command: 'cli-context', status: 'failed', run_id: 'run-failed',
        inserted_by: 'test', decision_ref: null,
      }];
      draft.session.orchestration.decision_points = [{
        point_id: 'DP-escalated', after_step_id: null, status: 'escalated', retry_count: 0,
        max_retries: 2, evidence_ref: null,
      }];
      return null;
    });

    await run('status', 'paused-status', '--workflow-root', projectRoot);
    const status = JSON.parse(logs.at(-1)!) as any;
    expect(status.revisions).toEqual(expect.objectContaining({
      identity: expect.any(Number),
      activity: expect.any(Number),
    }));
    expect(status.recovery.blockers).toEqual([
      expect.objectContaining({ kind: 'decision', id: 'DP-escalated', dispositions: ['proceed', 'retry'] }),
      expect.objectContaining({ kind: 'step', id: 'step-000-failed', dispositions: ['retry', 'skip'] }),
    ]);
    expect(status.recovery.next.command).toContain('--decision DP-escalated');
    expect(status.recovery.next.command).toContain(`--expected-identity-revision ${status.revisions.identity}`);
    expect(status.recovery.next.command).toContain(`--expected-activity-revision ${status.revisions.activity}`);

    store.update('paused-status', draft => {
      draft.session.orchestration.chain[0].status = 'skipped';
      draft.session.orchestration.decision_points[0].status = 'passed';
      return null;
    });
    const beforeResume = store.readBundle('paused-status').session;
    await run(
      'recover', '--session', 'paused-status', '--resume',
      '--request-id', 'req-cli-resume', '--actor', 'test', '--reason', 'blockers cleared',
      '--evidence', 'evidence/one.json', '--evidence', 'evidence/two.json',
      '--expected-identity-revision', String(beforeResume.identity_revision),
      '--expected-activity-revision', String(beforeResume.activity_revision),
      '--workflow-root', projectRoot,
    );
    expect(store.readBundle('paused-status').session.status).toBe('running');
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ operation: 'resume', session_id: 'paused-status' });
  });

  it('rejects malformed nested chain input before allocating a Session', async () => {
    const chainFile = join(projectRoot, 'invalid-chain.json');
    writeFileSync(chainFile, JSON.stringify({
      intent: 'invalid nested decomposition',
      steps: [{ command: 'cli-context' }],
      decomposition: { goals: [{}] },
    }));
    const sessionId = 'invalid-chain-20260723-000000';

    await run(
      'start', '--id', sessionId, '--chain-file', chainFile, '--no-dispatch',
      '--workflow-root', projectRoot,
    );

    expect(process.exitCode).toBe(1);
    expect(new SessionStore(projectRoot).sessionExists(sessionId)).toBe(false);
  });

  it('run done completes an explicit Run without requiring the legacy complete spelling', async () => {
    await run(
      'start',
      'done alias',
      '--cmd',
      'cli-context',
      '--id',
      'done-session',
      '--workflow-root',
      projectRoot,
    );
    const started = JSON.parse(logs.at(-1)!) as { session_id: string; run_id: string };
    expect(started.session_id).toMatch(/^done-session-\d{8}-\d{6}$/);

    await run(
      'done',
      '--session',
      started.session_id,
      '--summary',
      'done',
      '--workflow-root',
      projectRoot,
    );
    const completed = JSON.parse(logs.at(-1)!) as { run_sealed: boolean; session_id: string };
    expect(completed).toMatchObject({ run_sealed: true, session_id: started.session_id });
    expect(stderrWrites.join('')).toContain(`maestro run seal-session ${started.session_id}`);
  });
});
