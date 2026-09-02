import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeRepositoryIdentity } from '../repository/context.js';
import { registerSpecCommand } from './spec.js';

vi.mock('../search/daemon-client.js', () => ({
  invalidateSearchIndex: vi.fn(async () => false),
}));

const originalCwd = process.cwd();
const roots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = undefined;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('spec repository context', () => {
  it('writes a default project mutation to the nearest repository root from a nested cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-spec-nested-root-'));
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    initializeRepositoryIdentity(root, { repoName: 'Nested spec host' });
    const nested = join(root, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerSpecCommand(program);
    await program.parseAsync([
      'node', 'maestro', 'spec', 'add', 'coding', 'Nested context rule',
      'Mutate the repository context, not the invocation directory.',
    ]);

    const rootSpec = join(root, '.workflow', 'specs', 'coding-conventions.md');
    expect(readFileSync(rootSpec, 'utf8')).toContain('Nested context rule');
    expect(existsSync(join(nested, '.workflow'))).toBe(false);
  });

  it('loads root specs and root linked-workspace config from a nested cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-spec-nested-load-'));
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-spec-nested-linked-'));
    roots.push(root, linkedRoot);
    mkdirSync(join(root, '.workflow', 'specs'), { recursive: true });
    mkdirSync(join(linkedRoot, '.workflow', 'specs'), { recursive: true });
    initializeRepositoryIdentity(root, { repoName: 'Nested load host' });
    const linkedIdentity = initializeRepositoryIdentity(linkedRoot, { repoName: 'Nested load library' });
    writeFileSync(
      join(root, '.workflow', 'specs', 'coding-conventions.md'),
      '<spec-entry category="coding" keywords="nested" date="2026-08-12" title="Root load sentinel">\nRoot load body\n</spec-entry>\n',
    );
    writeFileSync(
      join(linkedRoot, '.workflow', 'specs', 'coding-conventions.md'),
      '<spec-entry category="coding" keywords="linked" date="2026-08-12" title="Linked config sentinel">\nLinked load body\n</spec-entry>\n',
    );
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      workspaces: {
        linked: [{
          name: 'library',
          path: linkedRoot,
          repo_id: linkedIdentity.repo_id,
          share: ['spec'],
        }],
      },
    }, null, 2));
    const nested = join(root, 'packages', 'feature', 'src');
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    const program = new Command();
    program.exitOverride();
    registerSpecCommand(program);
    await program.parseAsync(['node', 'maestro', 'spec', 'load', '--category', 'coding', '--json']);

    const output = JSON.parse(logs.at(-1)!) as { content: string };
    expect(output.content).toContain('Root load body');
    expect(output.content).toContain('Linked load body');
    expect(existsSync(join(nested, '.workflow'))).toBe(false);
  });
});
