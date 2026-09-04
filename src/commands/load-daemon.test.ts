import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';

const daemon = vi.hoisted(() => ({
  load: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonLoad: daemon.load,
  spawnDaemon: daemon.spawn,
}));

import { registerLoadCommand } from './load.js';

let previousCwd = process.cwd();
let root = '';

function entry(): WikiEntry {
  return {
    id: 'knowhow-fast-load',
    type: 'knowhow',
    title: 'Fast daemon load',
    summary: 'Warm index reuse',
    tags: ['performance'],
    status: 'active',
    created: '2026-09-02T00:00:00.000Z',
    updated: '2026-09-02T00:00:00.000Z',
    related: [],
    source: { kind: 'file', path: 'knowhow/fast-load.md' },
    body: 'The resident daemon serves load without a cold WikiIndexer.',
    ext: {},
    scope: 'project',
    category: 'performance',
    specCategory: null,
    createdBy: null,
    sourceRef: null,
    parent: null,
  };
}

beforeEach(() => {
  previousCwd = process.cwd();
  root = mkdtempSync(join(tmpdir(), 'maestro-load-daemon-'));
  mkdirSync(join(root, '.workflow'), { recursive: true });
  process.chdir(root);
  daemon.load.mockReset().mockResolvedValue({
    ok: true,
    entries: [entry()],
    generatedAt: 42,
  });
  daemon.spawn.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  process.chdir(previousCwd);
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('load daemon reuse', () => {
  it('serves list results from the warm daemon without spawning another process', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
    const program = new Command();
    program.exitOverride();
    registerLoadCommand(program);

    await program.parseAsync([
      'node', 'maestro', 'load', '--type', 'knowhow', '--list', '--json',
    ]);

    const output = JSON.parse(logs.at(-1)!) as {
      totalLoaded: number;
      entries: Array<{ id: string; title: string }>;
    };
    expect(output).toMatchObject({
      totalLoaded: 1,
      entries: [{ id: 'knowhow-fast-load', title: 'Fast daemon load' }],
    });
    expect(daemon.load).toHaveBeenCalledWith(
      join(root, '.workflow'),
      expect.objectContaining({
        timeoutMs: 1_500,
        authorityKey: expect.any(String),
      }),
    );
    expect(daemon.spawn).not.toHaveBeenCalled();
  });

  it('loads exact spec IDs from bounded file scopes without calling the daemon', async () => {
    const specsDir = join(root, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'debug-notes.md'), `# Debug Notes

<spec-entry category="debug" keywords="load,performance" date="2026-09-04" title="Bound exact spec load">

### Bound exact spec load

Exact spec IDs must not rebuild the whole Wiki corpus.

</spec-entry>
`);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
    const program = new Command();
    program.exitOverride();
    registerLoadCommand(program);

    await program.parseAsync([
      'node', 'maestro', 'load', '--type', 'spec',
      '--id', 'spec:project:debug-notes-001', '--json',
    ]);

    const output = JSON.parse(logs.at(-1)!) as {
      totalLoaded: number;
      entries: Array<{ id: string; title: string; body: string }>;
    };
    expect(output).toMatchObject({
      totalLoaded: 1,
      entries: [{
        id: 'spec:project:debug-notes-001',
        title: 'Bound exact spec load',
        body: expect.stringContaining('Exact spec IDs must not rebuild'),
      }],
    });
    expect(daemon.load).not.toHaveBeenCalled();
    expect(daemon.spawn).not.toHaveBeenCalled();
  });
});
