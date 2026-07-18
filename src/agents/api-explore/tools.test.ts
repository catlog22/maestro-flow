import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeToolAsync, TOOL_SCHEMAS } from './tools.js';

const tempDirs: string[] = [];

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-explore-tools-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Search tool', () => {
  it('accepts model-generated surrounding quotes without searching for literal quote characters', async () => {
    const root = createWorkspace();
    writeFileSync(join(root, 'config.ts'), 'export function checkProxyReachable() {}\n');

    const result = await executeToolAsync(
      'Search',
      JSON.stringify({ query: '"checkProxyReachable"', path: root }),
      root,
    );

    expect(result).toContain('config.ts:1:');
    expect(result).toContain('checkProxyReachable');
  });

  it('returns a clean no-match result for async rg exit code 1', async () => {
    const root = createWorkspace();
    writeFileSync(join(root, 'config.ts'), 'export const value = 1;\n');

    await expect(executeToolAsync(
      'Search',
      JSON.stringify({ query: 'missingSymbol', path: root }),
      root,
    )).resolves.toBe('No matches found.');
  });

  it('throws execution failures so agent traces mark tool_result as an error', async () => {
    const root = createWorkspace();

    await expect(executeToolAsync(
      'Search',
      JSON.stringify({ query: 'value', path: join(root, 'missing-directory') }),
      root,
    )).rejects.toThrow();
  });
});

describe('Read tool', () => {
  it('resolves a missing NodeNext .js import path to its TypeScript source file', async () => {
    const root = createWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'config.ts'), 'export const source = true;\n');

    const result = await executeToolAsync(
      'Read',
      JSON.stringify({ file_path: join(root, 'src', 'config.js') }),
      root,
    );

    expect(result.replace(/\\/g, '/')).toContain('[resolved source: src/config.ts]');
    expect(result).toContain('1\texport const source = true;');
  });

  it('rejects sibling paths that only share the cwd string prefix', async () => {
    const root = createWorkspace();
    const sibling = `${root}-outside`;
    mkdirSync(sibling, { recursive: true });
    tempDirs.push(sibling);
    writeFileSync(join(sibling, 'secret.ts'), 'secret');

    await expect(executeToolAsync(
      'Read',
      JSON.stringify({ file_path: join(sibling, 'secret.ts') }),
      root,
    )).rejects.toThrow('outside working directory');
  });

  it('indexes declarations omitted from the first page for targeted follow-up reads', async () => {
    const root = createWorkspace();
    const lines = Array.from({ length: 220 }, (_, index) =>
      index === 179 ? 'export function lateTarget() {}' : `// line ${index + 1}`,
    );
    writeFileSync(join(root, 'long-file.ts'), `${lines.join('\n')}\n`);

    const result = await executeToolAsync(
      'Batch',
      JSON.stringify({ commands: [{ type: 'Read', file_path: 'long-file.ts' }] }),
      root,
    );

    expect(result).toContain('next offset=161');
    expect(result).toContain('omitted declaration index');
    expect(result).toContain('180\tlateTarget');
  });

  it('reports an out-of-range offset instead of returning an empty successful Read', async () => {
    const root = createWorkspace();
    writeFileSync(join(root, 'short.md'), '# one\nline two\n');

    const result = await executeToolAsync(
      'Batch',
      JSON.stringify({ commands: [{ type: 'Read', file_path: 'short.md', offset: 20 }] }),
      root,
    );

    expect(result).toContain('offset 20 exceeds file length 3');
    expect(result).toContain('valid range is 1-3');
  });

  it('preserves a precise continuation when a multi-command Batch byte-truncates Markdown', async () => {
    const root = createWorkspace();
    const lines = Array.from({ length: 183 }, (_, index) =>
      `${index + 1} 中文证据行 ${'证据'.repeat(40)}`,
    );
    writeFileSync(join(root, 'audit.md'), `${lines.join('\n')}\n`);
    const commands: Array<{ type: 'Read'; file_path: string }> = [
      { type: 'Read', file_path: 'audit.md' },
    ];
    for (let index = 0; index < 8; index++) {
      const filePath = `short-${index}.txt`;
      writeFileSync(join(root, filePath), `short ${index}\n`);
      commands.push({ type: 'Read', file_path: filePath });
    }

    const first = await executeToolAsync('Batch', JSON.stringify({ commands }), root);
    const continuation = first.match(/next offset=(\d+); total lines=184/);
    expect(continuation).not.toBeNull();
    expect(first).toContain('batch Read truncated at file line');

    const offset = Number(continuation?.[1]);
    const resumed = await executeToolAsync(
      'Batch',
      JSON.stringify({ commands: [{ type: 'Read', file_path: 'audit.md', offset, limit: 1 }] }),
      root,
    );
    expect(resumed).toContain(`${offset}\t${offset} 中文证据行`);
  });
});

describe('Batch tool', () => {
  it('executes mixed commands, skips duplicates, and contains per-command errors', async () => {
    const root = createWorkspace();
    writeFileSync(join(root, 'config.ts'), 'export const batchSymbol = true;\n');

    const search = { type: 'Search', query: 'batchSymbol', path: root };
    const result = await executeToolAsync('Batch', JSON.stringify({
      commands: [
        search,
        { type: 'Read', file_path: join(root, 'config.ts') },
        search,
        { type: 'Read', file_path: join(root, 'missing.ts') },
      ],
    }), root);

    expect(result).toContain('Batch completed: 4 command(s), 1 error(s), 1 duplicate(s).');
    expect(result).toContain('config.ts:1:export const batchSymbol = true;');
    expect(result).toContain('Skipped duplicate command in this batch.');
    expect(result).toContain('missing.ts');
  });

  it('does not impose a schema command-count limit', () => {
    const batchSchema = TOOL_SCHEMAS[0].function.parameters as {
      properties: { commands: { maxItems?: number } };
    };

    expect(TOOL_SCHEMAS).toHaveLength(1);
    expect(TOOL_SCHEMAS[0].function.name).toBe('Batch');
    expect(batchSchema.properties.commands.maxItems).toBeUndefined();
  });
});
