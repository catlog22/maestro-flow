import { getEventListeners } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeRepositoryIdentity } from '../repository/context.js';
import {
  buildExactRipgrepArgs,
  normalizeExactLimits,
  parseExactRipgrepJsonLine,
  runExactSearch,
} from './exact-search.js';

const roots: string[] = [];

function repository(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `maestro-exact-${label}-`));
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  initializeRepositoryIdentity(root, { repoName: label });
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('standalone exact search', () => {
  it('returns every literal occurrence with relative Unicode-safe coordinates', async () => {
    const root = repository('current');
    mkdirSync(join(root, 'src', '中文目录'), { recursive: true });
    writeFileSync(join(root, 'src', '中文目录', '样例.ts'), 'needle needle\n中文needle\n', 'utf8');
    writeFileSync(join(root, '.gitignore'), 'ignored/\n', 'utf8');
    mkdirSync(join(root, 'ignored'), { recursive: true });
    writeFileSync(join(root, 'ignored', 'hidden.ts'), 'needle\n', 'utf8');
    writeFileSync(join(root, '.maestroignore'), 'maestro-private/\n', 'utf8');
    mkdirSync(join(root, 'maestro-private'), { recursive: true });
    writeFileSync(join(root, 'maestro-private', 'hidden.ts'), 'needle\n', 'utf8');
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(join(root, 'secrets', 'token.txt'), 'needle\n', 'utf8');
    writeFileSync(join(root, '.env'), 'needle\n', 'utf8');

    const outcome = await runExactSearch('needle', { projectRoot: root, limit: 20 });

    expect(outcome.truncated).toBe(false);
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.map(result => result.filePath)).toEqual([
      'src/中文目录/样例.ts',
      'src/中文目录/样例.ts',
      'src/中文目录/样例.ts',
    ]);
    expect(outcome.results.map(result => result.column)).toEqual([1, 8, 3]);
    expect(outcome.results.every(result => !result.filePath.includes('\\'))).toBe(true);
    expect(outcome.results.every(result => !result.filePath.includes(root))).toBe(true);
  });

  it('keeps query arguments literal, including option-looking text', () => {
    const args = buildExactRipgrepArgs({ root: 'C:/project', query: '--glob=*.ts' });
    const separator = args.indexOf('--');
    expect(separator).toBeGreaterThan(-1);
    expect(args.slice(separator)).toEqual(['--', '--glob=*.ts', '.']);
    expect(args).toContain('--fixed-strings');
  });

  it('fails closed for invalid caps and rejects empty/NUL queries', async () => {
    expect(() => normalizeExactLimits({ limit: 0 })).toThrow(/positive integer/);
    await expect(runExactSearch('')).rejects.toThrow(/must not be empty/);
    await expect(runExactSearch('bad\u0000query')).rejects.toThrow(/NUL/);
  });

  it('marks result truncation only when an occurrence exceeds the cap', async () => {
    const root = repository('cap');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'one.ts'), 'needle\n', 'utf8');
    writeFileSync(join(root, 'src', 'two.ts'), 'needle\n', 'utf8');
    const outcome = await runExactSearch('needle', { projectRoot: root, limit: 1 });
    expect(outcome.results).toHaveLength(1);
    expect(['src/one.ts', 'src/two.ts']).toContain(outcome.results[0]?.filePath);
    expect(outcome.truncated).toBe(true);
  });

  it('removes abort listeners after every successful pass', async () => {
    const root = repository('abort-listener');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'example.ts'), 'haystack\n', 'utf8');
    const controller = new AbortController();
    const baseline = getEventListeners(controller.signal, 'abort').length;

    for (let i = 0; i < 25; i += 1) {
      await runExactSearch('missing-value', {
        projectRoot: root,
        signal: controller.signal,
      });
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(baseline);
    }
  });

  it('parses every submatch in a JSON match event', () => {
    const root = repository('parser');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'example.ts'), 'xneedle needle\n', 'utf8');
    const line = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/example.ts' },
        lines: { text: 'xneedle needle\n' },
        line_number: 4,
        submatches: [{ start: 1, end: 7 }, { start: 8, end: 14 }],
      },
    });
    expect(parseExactRipgrepJsonLine(line, root).map(result => result.column)).toEqual([2, 9]);
  });

  it('includes only linked repositories with explicit codebase sharing and opt-in', async () => {
    const root = repository('host');
    const linked = repository('linked');
    const denied = repository('denied');
    const nestedLinked = join(root, 'nested-linked');
    mkdirSync(nestedLinked, { recursive: true });
    initializeRepositoryIdentity(nestedLinked, { repoName: 'nested-linked' });
    writeFileSync(join(nestedLinked, 'leak.ts'), 'needle\\n', 'utf8');
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      workspaces: {
        linked: [
          { name: 'allowed', path: linked, share: ['codebase'] },
          { name: 'denied', path: denied, share: ['spec'] },
          { name: 'nested', path: nestedLinked, share: ['spec'] },
        ],
      },
    }), 'utf8');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'local.ts'), 'needle\\n', 'utf8');
    writeFileSync(join(linked, 'linked.ts'), 'needle\\n', 'utf8');

    const local = await runExactSearch('needle', { projectRoot: root });
    expect(local.results.map(result => result.workspace)).toEqual([undefined]);
    const all = await runExactSearch('needle', { projectRoot: root, includeLinkedCode: true });
    expect(all.results.map(result => result.workspace)).toEqual([undefined, 'allowed']);
    expect(all.results.some(result => result.workspace === 'denied')).toBe(false);
    expect(all.results.some(result => result.workspace === 'nested')).toBe(false);
    expect(all.results.some(result => result.filePath.includes('nested-linked'))).toBe(false);
  });
});
