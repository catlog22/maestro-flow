// M6 — verification-ledger.json independent file: writes land in the file (not
// ralph-meta), reads merge the file with the legacy ralph-meta ledger, upsert
// replaces same-key entries, and file entries win on a key conflict.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergedLedger, readLedgerFile, upsertLedgerFile } from './verification-ledger.js';
import type { VerificationLedgerEntry } from './status-schema.js';

const roots: string[] = [];

function sessionDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-ledger-'));
  roots.push(path);
  mkdirSync(path, { recursive: true });
  return path;
}

function entry(overrides: Partial<VerificationLedgerEntry> = {}): VerificationLedgerEntry {
  return {
    authority: 'execute-gate',
    dimension: 'quality',
    subject_ids: ['src/a.ts'],
    evidence_hashes: { 'src/a.ts': 'hash-a' },
    scope_hash: 'scope-1',
    verdict: 'pass',
    confidence: 'high',
    concerns: null,
    risk_ceiling: 'low',
    created_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('verification-ledger.json file', () => {
  it('write lands in verification-ledger.json (not ralph-meta)', () => {
    const dir = sessionDir();
    upsertLedgerFile(dir, entry());
    const filePath = join(dir, 'verification-ledger.json');
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(join(dir, 'ralph-meta.json'))).toBe(false); // never touched
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed.schema_version).toBe('verification-ledger/1.0');
    expect(parsed.entries).toHaveLength(1);
  });

  it('readLedgerFile returns [] for a missing file', () => {
    expect(readLedgerFile(sessionDir())).toEqual([]);
  });

  it('upsert replaces an entry with the same authority + dimension + subjects', () => {
    const dir = sessionDir();
    upsertLedgerFile(dir, entry({ verdict: 'pass' }));
    upsertLedgerFile(dir, entry({ verdict: 'fail' })); // same key
    const entries = readLedgerFile(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].verdict).toBe('fail');
  });

  it('upsert appends a distinct-key entry', () => {
    const dir = sessionDir();
    upsertLedgerFile(dir, entry({ dimension: 'quality' }));
    upsertLedgerFile(dir, entry({ dimension: 'structure' }));
    expect(readLedgerFile(dir)).toHaveLength(2);
  });
});

describe('mergedLedger — file + legacy ralph-meta', () => {
  it('concatenates file entries with legacy entries', () => {
    const dir = sessionDir();
    upsertLedgerFile(dir, entry({ dimension: 'quality' }));
    const legacy = [entry({ dimension: 'structure' })];
    const merged = mergedLedger(dir, legacy);
    expect(merged).toHaveLength(2);
    expect(merged.map(e => e.dimension).sort()).toEqual(['quality', 'structure']);
  });

  it('file entry wins when a legacy entry shares the key', () => {
    const dir = sessionDir();
    upsertLedgerFile(dir, entry({ verdict: 'pass' }));
    const legacy = [entry({ verdict: 'fail' })]; // same key, stale
    const merged = mergedLedger(dir, legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].verdict).toBe('pass'); // file wins
  });

  it('legacy-only entries survive when the file is empty (un-migrated session)', () => {
    const dir = sessionDir();
    const legacy = [entry({ dimension: 'structure' })];
    const merged = mergedLedger(dir, legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].dimension).toBe('structure');
  });
});
