import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyRecursive } from './install-backend.js';
import { COMPONENT_DEFS } from '../core/component-defs.js';
import { createManifest } from '../core/manifest.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; src: string; dest: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-copy-test-'));
  roots.push(root);
  const src = join(root, 'src');
  const dest = join(root, 'dest');
  mkdirSync(src, { recursive: true });
  return { root, src, dest };
}

function copy(src: string, dest: string, fileFilter?: (name: string) => boolean) {
  const stats = { files: 0, dirs: 0, skipped: 0 };
  copyRecursive(src, dest, stats, createManifest('project', dest), fileFilter);
  return stats;
}

describe('copyRecursive', () => {
  it('overwrites a read-only destination file (Windows EPERM regression)', () => {
    const { src, dest } = fixture();
    writeFileSync(join(src, 'pack.idx'), 'v2');
    mkdirSync(dest, { recursive: true });
    const destFile = join(dest, 'pack.idx');
    writeFileSync(destFile, 'v1');
    chmodSync(destFile, 0o444);

    const stats = copy(src, dest);

    expect(stats.files).toBe(1);
    expect(readFileSync(destFile, 'utf8')).toBe('v2');
  });

  it('overwrites a nested read-only destination file', () => {
    const { src, dest } = fixture();
    mkdirSync(join(src, 'objects', 'pack'), { recursive: true });
    writeFileSync(join(src, 'objects', 'pack', 'a.pack'), 'new');
    const destFile = join(dest, 'objects', 'pack', 'a.pack');
    mkdirSync(join(dest, 'objects', 'pack'), { recursive: true });
    writeFileSync(destFile, 'old');
    chmodSync(destFile, 0o444);

    copy(src, dest);

    expect(readFileSync(destFile, 'utf8')).toBe('new');
  });

  it('skips .git directories entirely', () => {
    const { src, dest } = fixture();
    mkdirSync(join(src, 'repo', '.git', 'objects'), { recursive: true });
    writeFileSync(join(src, 'repo', '.git', 'objects', 'a.idx'), 'x');
    writeFileSync(join(src, 'repo', 'README.md'), 'x');

    copy(src, dest);

    expect(existsSync(join(dest, 'repo', 'README.md'))).toBe(true);
    expect(existsSync(join(dest, 'repo', '.git'))).toBe(false);
  });

  it('still throws on a genuinely uncopyable source', () => {
    const { src, dest } = fixture();
    expect(() => copy(join(src, 'missing'), dest)).toThrow();
  });
});

describe('ref component definition', () => {
  it('excludes the vendored zvec-grep clone like the npm files list', () => {
    const ref = COMPONENT_DEFS.find((d) => d.id === 'ref');
    expect(ref?.fileFilter?.('zvec-grep')).toBe(false);
    expect(ref?.fileFilter?.('tdd.md')).toBe(true);
    expect(ref?.fileFilter?.('sidebar.html')).toBe(true);
  });
});
