import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildV3HelpCatalog, registerHelpJsonCommand, validateArgvAgainstCatalog } from './help-json.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function v3Root(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-help-v3-'));

  v2Workspace(root);
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  writeFileSync(join(root, '.workflow', 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }, null, 2)}\n`);
  return root;
}

function invoke(args: string[]) {
  return spawnSync(process.execPath, [resolve('dist/src/cli.js'), ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
}

const REQUIRED = [
  'session open', 'session migrate', 'session complete', 'session archive', 'session unarchive',
  'session status', 'session resume-view',
  'session chain insert', 'session chain skip', 'session chain replace', 'session chain update',
  'run next', 'run create', 'run transition', 'run complete', 'run cancel', 'run seal', 'run brief', 'run check',
  'run decide', 'run recall',
  'session list',
  'execution operation claim', 'execution operation heartbeat',
  'execution operation release', 'execution operation status',
  'artifact inspect', 'artifact republish',
];

describe('v3 help catalog', () => {
  it('is generated from the registered Commander tree and covers the contract surface', () => {
    const catalog = buildV3HelpCatalog();
    const names = catalog.map(item => item.command);
    for (const command of REQUIRED) expect(names).toContain(command);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
  });

  it('reports mutation scope, CAS options, and retired replacements consistently', () => {
    const catalog = buildV3HelpCatalog();
    for (const item of catalog) {
      if (item.cas_target === 'run') expect(item.options).toContain('--expected-run-revision');
      if (item.cas_target === 'orchestration' && item.command !== 'session migrate') {
        expect(item.options).toContain('--expected-orchestration-revision');
      }
      if ((item.mutation_scope === 'run' || item.mutation_scope === 'orchestration')
        && item.command !== 'session open') {
        expect(item.options).toEqual(expect.arrayContaining(['--participant', '--actor', '--request-id']));
      }
      if (item.deprecated) {
        expect(
          item.command.startsWith('execution ')
          || ['run status', 'run done', 'run list', 'session done'].includes(item.command),
        ).toBe(true);
        expect(item.replacement).toBeTruthy();
        expect(item.mutation_scope).toBe('retired');
      }
      if (item.command === 'session migrate') {
        expect(item.options).toEqual(expect.arrayContaining([
          '--expected-identity-revision', '--expected-activity-revision', '--expected-revisions',
        ]));
      } else {
        expect(item.options).not.toContain('--expected-activity-revision');
      }
    }
    const migration = catalog.find(item => item.command === 'session migrate');
    const inspect = catalog.find(item => item.command === 'artifact inspect');
    const republish = catalog.find(item => item.command === 'artifact republish');
    const complete = catalog.find(item => item.command === 'run complete');
    const recoverySeal = catalog.find(item => item.command === 'run seal');
    const chainUpdate = catalog.find(item => item.command === 'session chain update');
    expect(inspect).toMatchObject({ mutation_scope: 'read', cas_target: 'none' });
    expect(republish).toMatchObject({ mutation_scope: 'artifact', cas_target: 'artifact' });
    expect(republish?.options).toEqual(expect.arrayContaining([
      '--assessment-hash', '--request-id', '--expected-artifact-revision', '--expected-session-revision',
      '--participant', '--actor', '--reason', '--evidence',
    ]));
    expect(complete?.description).toBe('Complete and seal a Run atomically');
    expect(complete?.options).toContain('--advance');
    expect(recoverySeal?.description).toBe('Deprecated recovery seal for an already terminal pre-upgrade Run');
    expect(chainUpdate).toMatchObject({
      mutation_scope: 'orchestration', cas_target: 'orchestration',
      description: expect.stringContaining('clearing is unsupported'),
    });
    expect(chainUpdate?.options).toEqual(expect.arrayContaining([
      '--session', '--step-id', '--command', '--arg', '--goal-ref', '--stage', '--decision-ref',
      '--participant', '--actor', '--request-id', '--reason', '--expected-orchestration-revision',
    ]));
    expect(migration).toMatchObject({ mutation_scope: 'orchestration', cas_target: 'orchestration' });
    expect(migration?.options).toEqual(expect.arrayContaining([
      '--participant', '--actor', '--to-v3', '--request-id', '--reason',
      '--expected-identity-revision', '--expected-activity-revision', '--expected-revisions',
    ]));
    // Retired-name stubs stay listed so preflight accepts `--json` and the CLI
    // can return the routable retirement envelope — but they are never
    // advertised as live reads.
    for (const [stub, replacement] of [
      ['run status', 'run check'],
      ['run done', 'run complete'],
      ['run list', 'session list'],
      ['session done', 'session complete'],
    ] as const) {
      const entry = catalog.find(item => item.command === stub);
      expect(entry).toMatchObject({ mutation_scope: 'retired', deprecated: true });
      expect(entry?.replacement).toContain(replacement);
      expect(entry?.options).toContain('--json');
    }
  });

  it('validates argv against Commander-derived option metadata with suggestions', () => {
    const catalog = buildV3HelpCatalog();
    const typo = validateArgvAgainstCatalog(catalog, ['session', 'open', 'objective', '--jsno']);
    expect(typo.ok).toBe(false);
    expect(typo.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNKNOWN_OPTION', argument: '--jsno', suggestion: '--json' }),
      expect.objectContaining({ code: 'MISSING_REQUIRED', argument: '--id' }),
    ]));
    const valid = validateArgvAgainstCatalog(catalog, [
      'session', 'open', 'objective', '--id', 'session-1',
      '--participant', 'pi', '--actor', 'pi', '--request-id', 'req-1', '--reason', 'test', '--json',
    ]);
    expect(valid).toEqual({ ok: true, errors: [] });
    const unsafe = validateArgvAgainstCatalog(catalog, [
      'session', 'open', 'objective', '--id', 'session-1',
      '--participant', 'pi', '--actor', 'pi', '--request-id', 'run-control:0#abc', '--reason', 'test', '--json',
    ]);
    expect(unsafe.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_VALUE', argument: '--request-id' }),
    ]));
  });

  it('requires --json before emitting the catalog', async () => {
    const program = new Command().exitOverride();
    registerHelpJsonCommand(program);
    await expect(program.parseAsync(['node', 'maestro', 'help']))
      .rejects.toThrow(/required option '--json'/);
  });

  it.each(['split', 'equal'] as const)('emits the real v3 catalog with a %s workflow root', (rootSyntax) => {
    const root = v3Root();
    const rootArgs = rootSyntax === 'split' ? ['--workflow-root', root] : [`--workflow-root=${root}`];
    const result = invoke(['help', '--json', ...rootArgs]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const body = JSON.parse(result.stdout);
    expect(body.schema_version).toBe('help-catalog/1.0');
    expect(body.commands.map((item: { command: string }) => item.command)).toEqual(expect.arrayContaining(REQUIRED));
    const complete = body.commands.find((item: { command: string }) => item.command === 'run complete');
    expect(complete.option_specs.find((option: { names: string[] }) => option.names.includes('--request-id')))
      .toMatchObject({ value_constraint: 'portable-path-segment' });
  });

  it('preserves Commander help [command] output for the v2 CLI', () => {
    const result = invoke(['help', 'run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/Usage: maestro run/);
    expect(result.stdout).not.toContain('help-catalog/1.0');
  });

  it('does not advertise the v3 catalog in a v2 workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-help-v2-'));

    v2Workspace(root);
    roots.push(root);
    mkdirSync(join(root, '.workflow'), { recursive: true });
    const program = new Command().exitOverride();
    registerHelpJsonCommand(program);
    await expect(program.parseAsync(['node', 'maestro', 'help', '--json', '--workflow-root', root]))
      .rejects.toThrow(/session\/3\.0 writer/);
  });
});
