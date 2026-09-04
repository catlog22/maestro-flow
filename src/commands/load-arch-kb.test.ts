import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const archKb = vi.hoisted(() => ({
  contentPath: '',
  resolveContentPath: vi.fn(),
  entries: [{
    id: 'arch-tpl-ai-gateway',
    type: 'template' as const,
    title: 'AI Gateway Architecture Template',
    slug: 'ai-gateway',
    summary: 'Routing, limits, and failover',
    keywords: ['gateway', 'proxy'],
    path: 'templates/ai-gateway/README.md',
    sections: ['Architecture overview'],
  }],
}));

const daemon = vi.hoisted(() => ({
  load: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../arch-kb/index.js', () => ({
  requireArchKbIndex: () => ({ entries: archKb.entries }),
  resolveArchKbContentPath: archKb.resolveContentPath,
}));

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonLoad: daemon.load,
  spawnDaemon: daemon.spawn,
}));

import { registerLoadCommand } from './load.js';

let previousCwd = process.cwd();
let root = '';

beforeEach(() => {
  previousCwd = process.cwd();
  root = mkdtempSync(join(tmpdir(), 'maestro-load-arch-kb-'));
  mkdirSync(join(root, '.workflow'), { recursive: true });
  const contentPath = join(root, 'ai-gateway.md');
  writeFileSync(contentPath, '# AI Gateway\n\nTemplate body.\n', 'utf8');
  archKb.contentPath = contentPath;
  archKb.resolveContentPath.mockReset().mockImplementation(() => archKb.contentPath);
  daemon.load.mockReset();
  daemon.spawn.mockReset();
  process.chdir(root);
  process.exitCode = undefined;
});

afterEach(() => {
  process.chdir(previousCwd);
  process.exitCode = undefined;
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function program(): Command {
  const command = new Command();
  command.exitOverride();
  registerLoadCommand(command);
  return command;
}

describe('load architecture templates', () => {
  it('loads full template content by canonical ID without using the Wiki daemon', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });

    await program().parseAsync([
      'node', 'maestro', 'load', '--type', 'template',
      '--id', 'arch-tpl-ai-gateway', '--json',
    ]);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      totalLoaded: 1,
      entries: [{
        id: 'arch-tpl-ai-gateway',
        type: 'template',
        category: 'arch-kb',
        referenceOnly: true,
        body: '# AI Gateway\n\nTemplate body.\n',
      }],
    });
    expect(daemon.load).not.toHaveBeenCalled();
    expect(daemon.spawn).not.toHaveBeenCalled();
  });

  it('accepts the Arch-KB slug and emits the unified text envelope', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });

    await program().parseAsync([
      'node', 'maestro', 'load', '--type', 'template', '--id', 'ai-gateway',
    ]);

    expect(logs.at(-1)).toContain('# Loaded 1 entries');
    expect(logs.at(-1)).toContain('## [template] [arch-kb] AI Gateway Architecture Template');
    expect(logs.at(-1)).toContain('Template body.');
  });

  it('lists template metadata without reading source markdown', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });

    await program().parseAsync([
      'node', 'maestro', 'load', '--type', 'template', '--list', '--json',
    ]);

    const output = JSON.parse(logs.at(-1)!) as {
      totalLoaded: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(output.totalLoaded).toBe(1);
    expect(output.entries[0]).toMatchObject({
      id: 'arch-tpl-ai-gateway',
      type: 'template',
      referenceOnly: true,
    });
    expect(output.entries[0]).not.toHaveProperty('body');
    expect(archKb.resolveContentPath).not.toHaveBeenCalled();
  });

  it('fails clearly for an unknown template ID', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });

    await program().parseAsync([
      'node', 'maestro', 'load', '--type', 'template', '--id', 'arch-tpl-missing',
    ]);

    expect(errors).toContain('Not found: arch-tpl-missing');
    expect(errors).toContain('No entries found.');
    expect(process.exitCode).toBe(1);
    expect(daemon.load).not.toHaveBeenCalled();
  });
});
