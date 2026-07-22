import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hashFile,
  computeFileHash,
  computeFileHashes,
  isFileTooLarge,
} from '../content-hash.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'content-hash-test-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('hashFile (shared low-level hasher)', () => {
  it('returns the full sha256 hex digest by default', () => {
    const file = join(tmpDir, 'a.txt');
    writeFileSync(file, 'hello world');
    expect(hashFile(file)).toBe(sha256('hello world'));
    expect(hashFile(file)).toHaveLength(64);
  });

  it('truncates the digest when options.truncate is set', () => {
    const file = join(tmpDir, 'b.txt');
    writeFileSync(file, 'hello world');
    const truncated = hashFile(file, { truncate: 16 });
    expect(truncated).toBe(sha256('hello world').substring(0, 16));
    expect(truncated).toHaveLength(16);
  });

  it('throws on a missing file (callers wrap this)', () => {
    expect(() => hashFile(join(tmpDir, 'nope.txt'))).toThrow();
  });
});

describe('computeFileHash (full digest contract)', () => {
  it('returns the full sha256 digest for a normal file', () => {
    const file = join(tmpDir, 'c.txt');
    writeFileSync(file, 'maestro');
    expect(computeFileHash(file)).toBe(sha256('maestro'));
  });

  it('returns null for a missing file', () => {
    expect(computeFileHash(join(tmpDir, 'missing.txt'))).toBeNull();
  });

  it('returns null for a file larger than 1MB', () => {
    const file = join(tmpDir, 'big.bin');
    writeFileSync(file, Buffer.alloc(1_048_577, 1)); // 1MB + 1 byte
    expect(computeFileHash(file)).toBeNull();
  });
});

describe('computeFileHashes', () => {
  it('hashes multiple files into a relPath → hash map, skipping unreadable ones', () => {
    writeFileSync(join(tmpDir, 'x.txt'), 'x');
    writeFileSync(join(tmpDir, 'y.txt'), 'y');
    const map = computeFileHashes([
      { absolutePath: join(tmpDir, 'x.txt'), relPath: 'x.txt' },
      { absolutePath: join(tmpDir, 'y.txt'), relPath: 'y.txt' },
      { absolutePath: join(tmpDir, 'gone.txt'), relPath: 'gone.txt' },
    ]);
    expect(map.get('x.txt')).toBe(sha256('x'));
    expect(map.get('y.txt')).toBe(sha256('y'));
    expect(map.has('gone.txt')).toBe(false);
  });
});

describe('isFileTooLarge', () => {
  it('false for a small file, true for > 1MB, false for missing', () => {
    const small = join(tmpDir, 'small.txt');
    writeFileSync(small, 'tiny');
    const big = join(tmpDir, 'big.bin');
    writeFileSync(big, Buffer.alloc(1_048_577, 1));

    expect(isFileTooLarge(small)).toBe(false);
    expect(isFileTooLarge(big)).toBe(true);
    expect(isFileTooLarge(join(tmpDir, 'missing.txt'))).toBe(false);
  });
});
