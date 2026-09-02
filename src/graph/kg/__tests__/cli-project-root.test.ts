import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaestroGraph } from '../engine.js';
import type { UnifiedNode } from '../db/types.js';
import { getKgDatabasePath } from '../db/connection.js';
import { registerKgCommands } from '../surface/cli.js';
import {
  resolveExternalSurfaceProjectRoot,
  resolveKgCliProjectRoot,
} from '../surface/project-root.js';

const roots: string[] = [];

function makeRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function makeNode(name: string): UnifiedNode {
  return {
    id: `code:/project/${name}.ts:${name}`,
    kind: 'function',
    name,
    qualifiedName: name,
    filePath: `/project/${name}.ts`,
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: `function ${name}() {}`,
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {},
    updatedAt: 1,
  };
}

async function seedGraph(root: string, nodeName: string): Promise<void> {
  const graph = await MaestroGraph.init(root);
  graph.getQueryBuilder().insertNodes([makeNode(nodeName)]);
  graph.close();
}

async function runCli(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation(value => { stdout.push(String(value)); });
  const error = vi.spyOn(console, 'error').mockImplementation(value => { stderr.push(String(value)); });
  process.exitCode = undefined;
  try {
    process.chdir(cwd);
    const program = new Command();
    program.exitOverride();
    registerKgCommands(program);
    await program.parseAsync(['node', 'maestro', ...args]);
    return {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exitCode: process.exitCode,
    };
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('KG CLI project root resolution', () => {
  it('uses the initialized workspace root for nested health, open, and query commands', async () => {
    const root = makeRoot('maestro-kg-cli-root-');
    const nested = join(root, 'Sources', 'Feature');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await seedGraph(root, 'CanonicalNode');
    await seedGraph(nested, 'ShadowNode');

    const health = await runCli(nested, ['kg', 'health', '--json']);
    expect(health.exitCode).not.toBe(1);
    expect(JSON.parse(health.stdout)).toMatchObject({
      database: getKgDatabasePath(root),
    });

    const open = await runCli(nested, ['kg', 'search', 'CanonicalNode', '--json']);
    expect(open.exitCode).not.toBe(1);
    expect(JSON.parse(open.stdout)).toMatchObject({
      nodes: [expect.objectContaining({ name: 'CanonicalNode' })],
    });

    const query = await runCli(nested, ['kg', 'query', 'CanonicalNode', '--json']);
    expect(query.exitCode).not.toBe(1);
    expect(JSON.parse(query.stdout)).toMatchObject({
      results: [expect.objectContaining({ name: 'CanonicalNode' })],
    });
    expect(existsSync(getKgDatabasePath(nested))).toBe(true);
    expect(query.stdout).not.toContain('ShadowNode');
  });

  it('uses the Git root for init and sync resolution before a Maestro workspace exists', async () => {
    const root = makeRoot('maestro-kg-cli-git-root-');
    const nested = join(root, 'Sources', 'Feature');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);

    expect(resolveKgCliProjectRoot(nested)).toBe(root);

    const init = await runCli(nested, ['kg', 'init']);
    expect(init.exitCode).not.toBe(1);
    expect(existsSync(getKgDatabasePath(root))).toBe(true);
    expect(existsSync(getKgDatabasePath(nested))).toBe(false);

    const syncRoot = makeRoot('maestro-kg-cli-sync-git-root-');
    const syncNested = join(syncRoot, 'Sources', 'Feature');
    mkdirSync(syncNested, { recursive: true });
    execFileSync('git', ['init', '--quiet', syncRoot]);

    const sync = await runCli(syncNested, ['kg', 'sync', '--source', 'domain', '--json']);
    expect(sync.exitCode).not.toBe(1);
    expect(existsSync(getKgDatabasePath(syncRoot))).toBe(true);
    expect(existsSync(getKgDatabasePath(syncNested))).toBe(false);
  });

  it('uses the nearest initialized workspace when a nested cwd is outside Git', async () => {
    const root = makeRoot('maestro-kg-cli-no-git-root-');
    const nested = join(root, 'Packages', 'Feature');
    mkdirSync(nested, { recursive: true });
    await seedGraph(root, 'OuterNode');
    await seedGraph(nested, 'NearestNode');

    expect(resolveKgCliProjectRoot(join(nested, 'src'))).toBe(nested);
  });

  it('honors an explicit nested project-root override inside a Git worktree', async () => {
    const root = makeRoot('maestro-kg-cli-explicit-root-');
    const nested = join(root, 'Packages', 'Feature');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await seedGraph(root, 'CanonicalNode');
    await seedGraph(nested, 'NestedNode');

    const previousProjectRoot = process.env.MAESTRO_PROJECT_ROOT;
    process.env.MAESTRO_PROJECT_ROOT = nested;
    try {
      expect(resolveKgCliProjectRoot(root)).toBe(nested);
      const health = await runCli(root, ['kg', 'health', '--json']);
      expect(health.exitCode).not.toBe(1);
      expect(JSON.parse(health.stdout)).toMatchObject({
        database: getKgDatabasePath(nested),
      });
    } finally {
      if (previousProjectRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
      else process.env.MAESTRO_PROJECT_ROOT = previousProjectRoot;
    }
  });

  it('finds a root external-surfaces manifest from a nested cwd before DB initialization', async () => {
    const root = makeRoot('maestro-kg-cli-external-surface-');
    const nested = join(root, 'Sources', 'Feature');
    const header = join(root, 'Pods', 'Module', 'Header.h');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, '.workflow', 'kg'), { recursive: true });
    mkdirSync(join(root, 'Pods', 'Module'), { recursive: true });
    writeFileSync(header, '@interface Header : NSObject\n@end\n');
    writeFileSync(join(root, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
      schema_version: 'kg-external-surfaces/1.0',
      files: [{ module: 'Module', language: 'objc', path: 'Pods/Module/Header.h' }],
    }));

    expect(resolveExternalSurfaceProjectRoot(nested)).toBe(root);
    const result = await runCli(nested, ['kg', 'external-surfaces', 'validate', '--json']);
    expect(result.exitCode).not.toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      configPath: join(root, '.workflow', 'kg', 'external-surfaces.json'),
      configured: 1,
      resolved: 1,
      errors: [],
    });
    expect(existsSync(join(nested, '.workflow', 'kg', 'external-surfaces.json'))).toBe(false);
  });

  it('does not inherit an external-surfaces manifest across a nested Git root', async () => {
    const outerRoot = makeRoot('maestro-kg-cli-external-outer-');
    const nestedRoot = join(outerRoot, 'Vendor', 'Nested');
    const nestedCwd = join(nestedRoot, 'Sources', 'Feature');
    mkdirSync(nestedCwd, { recursive: true });
    mkdirSync(join(outerRoot, '.workflow', 'kg'), { recursive: true });
    writeFileSync(join(outerRoot, '.workflow', 'kg', 'maestro.db'), '');
    writeFileSync(join(outerRoot, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
      schema_version: 'kg-external-surfaces/1.0',
      files: [],
    }));
    execFileSync('git', ['init', '--quiet', outerRoot]);
    execFileSync('git', ['init', '--quiet', nestedRoot]);

    expect(resolveKgCliProjectRoot(nestedCwd)).toBe(realpathSync(nestedRoot));
    expect(resolveExternalSurfaceProjectRoot(nestedCwd)).toBe(realpathSync(nestedRoot));

    const result = await runCli(nestedCwd, ['kg', 'external-surfaces', 'validate', '--json']);
    expect(result.exitCode).not.toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      configPath: join(realpathSync(nestedRoot), '.workflow', 'kg', 'external-surfaces.json'),
      configured: 0,
      resolved: 0,
      errors: [],
    });
  });

  it('ignores a nested shadow manifest inside the same Git worktree', async () => {
    const root = makeRoot('maestro-kg-cli-external-shadow-');
    const nested = join(root, 'Sources');
    const header = join(nested, 'Shadow.h');
    mkdirSync(join(nested, '.workflow', 'kg'), { recursive: true });
    writeFileSync(header, '@interface Shadow : NSObject\n@end\n');
    writeFileSync(join(nested, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
      schema_version: 'kg-external-surfaces/1.0',
      files: [{ module: 'Shadow', language: 'objc', path: 'Shadow.h' }],
    }));
    execFileSync('git', ['init', '--quiet', root]);

    expect(resolveKgCliProjectRoot(nested)).toBe(root);
    expect(resolveExternalSurfaceProjectRoot(nested)).toBe(root);

    const result = await runCli(nested, ['kg', 'external-surfaces', 'validate', '--json']);
    expect(result.exitCode).not.toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      configPath: join(root, '.workflow', 'kg', 'external-surfaces.json'),
      configured: 0,
      resolved: 0,
      errors: [],
    });
  });
});
