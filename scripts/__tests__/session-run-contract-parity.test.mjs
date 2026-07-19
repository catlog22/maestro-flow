import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const gatePath = join(repoRoot, 'scripts', 'check-session-run-contract-parity.mjs');
const fixtureFiles = [
  'package.json',
  'src/run/schemas.ts',
  'src/run/protocol-schemas.ts',
  'dashboard/src/server/wiki/virtual-wiki-adapters.ts',
  'dashboard/src/server/wiki/wiki-indexer.ts',
  'guide/search-system-guide.md',
  'guide/search-system-guide.en.md',
  'guide/session-run-architecture.md',
  'guide/session-run-structure-guide.md',
  'guide/cli-commands-guide.md',
  'guide/cli-commands-guide.en.md',
];
const tempRoots = [];

function runGate(root = null) {
  return spawnSync(process.execPath, root === null ? [gatePath] : [gatePath, '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'session-run-contract-parity-'));
  tempRoots.push(root);
  for (const relativePath of fixtureFiles) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), target);
  }
  return root;
}

function replaceOnce(root, relativePath, before, after) {
  const path = join(root, relativePath);
  const text = readFileSync(path, 'utf8');
  expect(text).toContain(before);
  writeFileSync(path, text.replace(before, after));
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('Session Run contract parity release gate', () => {
  it('passes the current repository contract', () => {
    const result = runGate();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('PASS writer.session.current');
    expect(result.stdout).toContain('PASS reader.session.compatibility');
    expect(result.stdout).toContain('PASS cache.search.version');
    expect(result.stdout).toContain('PASS response.operations.complete');
    expect(result.stdout).toContain('PASS docs.search.zh');
    expect(result.stdout).toContain('PASS package.prepublish.order');
  });

  it('fails each independent Session Run contract drift dimension', () => {
    const cases = [
      {
        dimension: 'writer',
        id: 'writer.session.current',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('session/1.3')", "schema_version: z.literal('session/9.9')");
        },
      },
      {
        dimension: 'reader',
        id: 'reader.session.compatibility',
        mutate(root) {
          replaceOnce(root, 'dashboard/src/server/wiki/virtual-wiki-adapters.ts', "&& raw.schema_version !== 'session/1.3'", "&& raw.schema_version !== 'session/9.9'");
        },
      },
      {
        dimension: 'cache',
        id: 'cache.search.version',
        mutate(root) {
          replaceOnce(root, 'dashboard/src/server/wiki/wiki-indexer.ts', 'const SEARCH_CACHE_VERSION = 3;', 'const SEARCH_CACHE_VERSION = 2;');
        },
      },
      {
        dimension: 'operation',
        id: 'response.operations.complete',
        mutate(root) {
          replaceOnce(
            root,
            'src/run/protocol-schemas.ts',
            "'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update',",
            "'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip',",
          );
        },
      },
      {
        dimension: 'docs',
        id: 'docs.search.zh',
        mutate(root) {
          replaceOnce(root, 'guide/search-system-guide.md', '`session/1.3` + `command-run/1.3`', '`session/9.9` + `command-run/1.3`');
        },
      },
      {
        dimension: 'package',
        id: 'package.command',
        mutate(root) {
          replaceOnce(root, 'package.json', 'node scripts/check-session-run-contract-parity.mjs', 'node scripts/incorrect-contract-gate.mjs');
        },
      },
    ];

    for (const testCase of cases) {
      const root = createFixture();
      testCase.mutate(root);
      const result = runGate(root);
      expect(result.status, `${testCase.dimension}: ${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(result.stdout, testCase.dimension).toContain(`FAIL ${testCase.id}`);
    }
  });
});
