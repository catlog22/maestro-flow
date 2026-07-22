import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFileHash, hasFileChanged } from '../incremental-sync.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'incremental-sync-test-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function sha256Truncated16(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

describe('kg incremental-sync computeFileHash (truncated contract)', () => {
  it('returns the sha256 digest truncated to 16 chars', () => {
    const file = join(tmpDir, 'a.txt');
    writeFileSync(file, 'maestro');
    const hash = computeFileHash(file);
    expect(hash).toBe(sha256Truncated16('maestro'));
    expect(hash).toHaveLength(16);
  });

  it("returns '' for a missing file (preserved contract)", () => {
    expect(computeFileHash(join(tmpDir, 'missing.txt'))).toBe('');
  });
});

describe('hasFileChanged', () => {
  it('returns false when the stored hash matches the current content', () => {
    const file = join(tmpDir, 'b.txt');
    writeFileSync(file, 'stable');
    const stored = computeFileHash(file);
    expect(hasFileChanged(file, stored)).toBe(false);
  });

  it('returns true when the content changed since the stored hash', () => {
    const file = join(tmpDir, 'c.txt');
    writeFileSync(file, 'before');
    const stored = computeFileHash(file);
    writeFileSync(file, 'after');
    expect(hasFileChanged(file, stored)).toBe(true);
  });

  it('returns true for a missing file (empty current hash vs any stored)', () => {
    expect(hasFileChanged(join(tmpDir, 'gone.txt'), 'deadbeef')).toBe(true);
  });
});
