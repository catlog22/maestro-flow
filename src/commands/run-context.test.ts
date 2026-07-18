import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRunCommand } from './run.js';

let projectRoot: string;
let logs: string[];

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'maestro-run-cli-context-'));
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logs.push(String(value)); });
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
    expect(brief.resolved_platform).toBe('codex');
    expect(brief.run_dir).toBe(created.run_dir);
    expect(brief.chain_step_id).toBeNull();
  });

  it('removes free-form parent linkage and accepts only retry-token lineage', () => {
    const run = program().commands.find(item => item.name() === 'run');
    const create = run?.commands.find(item => item.name() === 'create');
    expect(create?.options.some(option => option.long === '--parent-run')).toBe(false);
    expect(create?.options.some(option => option.long === '--retry-token')).toBe(true);
    expect(create?.options.some(option => option.long === '--platform')).toBe(true);
  });
});
