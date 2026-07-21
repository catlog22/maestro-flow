import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRunCommand } from './run.js';
import { SessionStore } from '../run/store.js';

let projectRoot: string;
let logs: string[];
let stderrWrites: string[];

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'maestro-run-cli-context-'));
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
    expect(create?.helpInformation()).toContain('--intent <text>');
    expect(create?.helpInformation()).toContain('not passed to the command');
    expect(create?.helpInformation()).toContain('command input stored in Run input.args (repeatable)');
  });

  it('starts a chain Session from command names and edits pending steps in place', async () => {
    await run(
      'start',
      '统一 run session',
      '--id',
      'unified',
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
  });

  it('run done completes an explicit Run without requiring the legacy complete spelling', async () => {
    await run(
      'start',
      'done alias',
      '--cmd',
      'cli-context',
      '--session',
      'done-session',
      '--workflow-root',
      projectRoot,
    );
    const started = JSON.parse(logs.at(-1)!) as { session_id: string; run_id: string };

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
