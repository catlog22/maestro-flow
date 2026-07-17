// M6 — verification-ledger.json independent file: writes land in the file (not
// ralph-meta), reads merge the file with the legacy ralph-meta ledger, upsert
// replaces same-key entries, and file entries win on a key conflict.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergedLedger, readLedgerFile, upsertLedgerFile } from './verification-ledger.js';
import type { VerificationLedgerEntry } from './status-schema.js';

const roots: string[] = [];

function fixture(): { projectRoot: string; sessionId: string; sessionDir: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-ledger-'));
  roots.push(projectRoot);
  const sessionId = 'ledger-session';
  const sessionDir = join(projectRoot, '.workflow', 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  return { projectRoot, sessionId, sessionDir };
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
    const { projectRoot, sessionId, sessionDir } = fixture();
    upsertLedgerFile(projectRoot, sessionId, entry());
    const filePath = join(sessionDir, 'verification-ledger.json');
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(join(sessionDir, 'ralph-meta.json'))).toBe(false); // never touched
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed.schema_version).toBe('verification-ledger/1.0');
    expect(parsed.entries).toHaveLength(1);
  });

  it('readLedgerFile returns [] for a missing file', () => {
    const { projectRoot, sessionId } = fixture();
    expect(readLedgerFile(projectRoot, sessionId)).toEqual([]);
  });

  it('upsert replaces an entry with the same authority + dimension + subjects', () => {
    const { projectRoot, sessionId } = fixture();
    upsertLedgerFile(projectRoot, sessionId, entry({ verdict: 'pass' }));
    upsertLedgerFile(projectRoot, sessionId, entry({ verdict: 'fail' })); // same key
    const entries = readLedgerFile(projectRoot, sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0].verdict).toBe('fail');
  });

  it('upsert appends a distinct-key entry', () => {
    const { projectRoot, sessionId } = fixture();
    upsertLedgerFile(projectRoot, sessionId, entry({ dimension: 'quality' }));
    upsertLedgerFile(projectRoot, sessionId, entry({ dimension: 'structure' }));
    expect(readLedgerFile(projectRoot, sessionId)).toHaveLength(2);
  });

  it('rejects corrupt ledger JSON instead of overwriting it as empty', () => {
    const { projectRoot, sessionId, sessionDir } = fixture();
    writeFileSync(join(sessionDir, 'verification-ledger.json'), '{broken', 'utf8');
    expect(() => upsertLedgerFile(projectRoot, sessionId, entry())).toThrow(/Invalid JSON/);
  });
});

describe('mergedLedger — file + legacy ralph-meta', () => {
  it('concatenates file entries with legacy entries', () => {
    const { projectRoot, sessionId } = fixture();
    upsertLedgerFile(projectRoot, sessionId, entry({ dimension: 'quality' }));
    const legacy = [entry({ dimension: 'structure' })];
    const merged = mergedLedger(projectRoot, sessionId, legacy);
    expect(merged).toHaveLength(2);
    expect(merged.map(e => e.dimension).sort()).toEqual(['quality', 'structure']);
  });

  it('file entry wins when a legacy entry shares the key', () => {
    const { projectRoot, sessionId } = fixture();
    upsertLedgerFile(projectRoot, sessionId, entry({ verdict: 'pass' }));
    const legacy = [entry({ verdict: 'fail' })]; // same key, stale
    const merged = mergedLedger(projectRoot, sessionId, legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].verdict).toBe('pass'); // file wins
  });

  it('legacy-only entries survive when the file is empty (un-migrated session)', () => {
    const { projectRoot, sessionId } = fixture();
    const legacy = [entry({ dimension: 'structure' })];
    const merged = mergedLedger(projectRoot, sessionId, legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].dimension).toBe('structure');
  });
});
