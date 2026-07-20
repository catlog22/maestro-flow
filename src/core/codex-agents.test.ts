import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCodexAgents } from './skill-converter.js';
import { lintCodexAgentToml } from './codex-agent-overrides.js';

const repoRoot = process.cwd();
const claudeDir = join(repoRoot, '.claude');
const checkedInDir = join(repoRoot, '.codex', 'agents');

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'codex-agents-test-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tomlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.toml'))
    .map(entry => entry.name)
    .sort();
}

describe('Codex agent generation', () => {
  it('applies lifecycle overrides while preserving the canonical run_dir fallback', () => withTempDir((targetDir) => {
    const result = buildCodexAgents(claudeDir, targetDir);
    const sourceCount = readdirSync(join(claudeDir, 'agents')).filter(name => name.endsWith('.md')).length;
    expect(result.files).toBe(sourceCount);

    const worker = readFileSync(join(targetDir, 'team-worker.toml'), 'utf8');
    const supervisor = readFileSync(join(targetDir, 'team-supervisor.toml'), 'utf8');
    expect(worker).toContain('If absent, resolve from `<session>/team-session.json`');
    expect(worker).toContain('coordinators MUST keep the Run mapping in that single state file');
    expect(worker).toContain('initial `spawn_agent` prompt');
    expect(supervisor).toContain('concrete checkpoint assignment through `followup_task`');
    expect(`${worker}\n${supervisor}`).not.toMatch(/\b(?:TaskList|TaskGet|TaskUpdate)\b/);
    expect(`${worker}\n${supervisor}`).not.toMatch(/update_(?:goal|plan)\s*\(\s*\{[^}]*\btaskId\s*:/s);
  }));

  it('fails closed when an agent retains unsupported task-board semantics', () => withTempDir((root) => {
    const source = join(root, '.claude', 'agents');
    const target = join(root, 'out');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'invalid.md'), [
      '---',
      'name: invalid',
      'description: invalid lifecycle',
      'allowed-tools: [Read]',
      '---',
      '',
      '# Invalid',
      'Call `TaskUpdate({ taskId: "X", status: "completed" })`.',
    ].join('\n'));
    expect(() => buildCodexAgents(join(root, '.claude'), target)).toThrow(/unsupported TaskUpdate semantics/);
  }));

  it('passes schema lint and matches every checked-in TOML mirror', () => withTempDir((targetDir) => {
    buildCodexAgents(claudeDir, targetDir);
    const generated = tomlFiles(targetDir);
    expect(generated).toEqual(tomlFiles(checkedInDir));
    for (const file of generated) {
      const content = readFileSync(join(targetDir, file), 'utf8');
      expect(lintCodexAgentToml(file, content)).toEqual([]);
      expect(existsSync(join(checkedInDir, file))).toBe(true);
      expect(readFileSync(join(checkedInDir, file), 'utf8')).toBe(content);
    }
  }));

  it('passes the repository freshness check without rewriting mirrors', () => {
    const output = execFileSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'sync-codex-agents.mjs'), '--check'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(output).toContain('schema and parity OK');
  });

  it('rejects invalid Goal, Plan, wait, and live-agent task-board claims', () => {
    const invalid = [
      'name = "invalid"',
      'description = "invalid"',
      'sandbox_mode = "read-only"',
      '',
      'developer_instructions = """',
      'update_goal({ taskId: "T1", status: "in_progress" })',
      'update_plan({ taskId: "T1", status: "completed" })',
      'wait_agent(taskId)',
      'Use list_agents to find pending tasks and blockedBy.',
      '"""',
      '',
    ].join('\n');
    expect(lintCodexAgentToml('invalid.toml', invalid).map(issue => issue.rule)).toEqual(
      expect.arrayContaining(['goal-task-payload', 'plan-without-array', 'positional-wait', 'list-agents-task-board']),
    );
  });
});
