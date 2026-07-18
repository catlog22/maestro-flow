import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerIssueCommand } from './issue.js';
import { createIssue } from '../issues/store.js';

let workflowRoot: string;
let logs: string[];
let errors: string[];

beforeEach(() => {
  workflowRoot = join(mkdtempSync(join(tmpdir(), 'maestro-issue-')), '.workflow');
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
  vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(join(workflowRoot, '..'), { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerIssueCommand(program);
  await program.parseAsync(['node', 'maestro', 'issue', '--workflow-root', workflowRoot, ...args]);
}

function json(): any { return JSON.parse(logs.at(-1) ?? '{}'); }

describe('maestro issue', () => {
  it('creates collision-free sequential IDs', async () => {
    await run('create', '--title', 'First', '--json');
    const first = json();
    await run('create', '--title', 'Second', '--json');
    const second = json();
    expect(first.id).toMatch(/^ISS-\d{8}-001$/);
    expect(second.id).toMatch(/^ISS-\d{8}-002$/);
  });

  it('serializes concurrent creates without ID collisions', async () => {
    const created = await Promise.all(Array.from({ length: 5 }, (_, index) => createIssue(workflowRoot, {
      title: `Concurrent ${index}`,
      severity: 'medium',
      source: 'test',
      priority: 3,
    })));
    expect(new Set(created.map(issue => issue.id)).size).toBe(5);
    expect(created.map(issue => issue.id).sort()).toEqual([
      expect.stringMatching(/-001$/),
      expect.stringMatching(/-002$/),
      expect.stringMatching(/-003$/),
      expect.stringMatching(/-004$/),
      expect.stringMatching(/-005$/),
    ]);
  });

  it('lists, reads, updates, links, and closes an issue', async () => {
    await run('create', '--title', 'Lifecycle', '--severity', 'high', '--json');
    const id = json().id;
    await run('update', id, '--status', 'in_progress', '--fix-direction', 'outputs/solution.json', '--json');
    expect(json().status).toBe('in_progress');
    await run('link', id, '--task', 'TASK-001', '--json');
    expect(json().affected_components).toContain('TASK-001');
    await run('status', id, '--json');
    expect(json().fix_direction).toBe('outputs/solution.json');
    await run('close', id, '--resolution', 'Verified', '--json');
    expect(json().status).toBe('completed');
    await run('list', '--all', '--json');
    expect(json().issues).toHaveLength(1);
    expect(readFileSync(join(workflowRoot, 'issues', 'issues.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(workflowRoot, 'issues', 'issue-history.jsonl'), 'utf8')).toContain(id);
  });

  it('rejects malformed input without mutating storage', async () => {
    await run('create', '--title', 'Bad', '--priority', '9', '--json');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/Priority/);
  });
});
