import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeToolAsync } from './tools.js';

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
});
