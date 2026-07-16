// ---------------------------------------------------------------------------
// Verification ledger file — the independent `verification-ledger.json` store
// that M6 splits out of ralph-meta.json.
//
// The ledger is a verification *cache*, not orchestration state, so it lives in
// its own session-scoped file rather than session.json. Writes land here;
// reads merge this file with the legacy ralph-meta.verification_ledger so an
// un-migrated session's cached findings are still honoured (concat, dedupe by
// authority + dimension + subject set, this-file wins). No .bak rename/delete —
// ralph-meta.json is left untouched (non-destructive migration).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VerificationLedgerEntry } from './status-schema.js';

interface VerificationLedgerFile {
  schema_version: 'verification-ledger/1.0';
  entries: VerificationLedgerEntry[];
}

function ledgerPath(sessionDir: string): string {
  return join(sessionDir, 'verification-ledger.json');
}

/** Read the independent verification-ledger.json (empty when absent/corrupt). */
export function readLedgerFile(sessionDir: string): VerificationLedgerEntry[] {
  const path = ledgerPath(sessionDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<VerificationLedgerFile>;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** True when two ledger entries address the same authority + dimension + subjects. */
function sameKey(a: VerificationLedgerEntry, b: VerificationLedgerEntry): boolean {
  if (a.authority !== b.authority || a.dimension !== b.dimension) return false;
  const s1 = [...a.subject_ids].sort();
  const s2 = [...b.subject_ids].sort();
  if (s1.length !== s2.length) return false;
  return s1.every((val, i) => val === s2[i]);
}

/**
 * Effective ledger for reads: the independent file merged with the legacy
 * ralph-meta.verification_ledger. Concat with the independent file first; a
 * legacy entry is included only when no file entry shares its key (file wins on
 * conflict). Dropping duplicate keys keeps `find`-style queries deterministic.
 */
export function mergedLedger(
  sessionDir: string,
  legacy: VerificationLedgerEntry[],
): VerificationLedgerEntry[] {
  const fileEntries = readLedgerFile(sessionDir);
  const merged = [...fileEntries];
  for (const entry of legacy) {
    if (!merged.some(existing => sameKey(existing, entry))) merged.push(entry);
  }
  return merged;
}

/**
 * Upsert an entry into the independent verification-ledger.json, replacing any
 * entry with the same authority + dimension + subject set. Atomic write via a
 * temp file + rename (no in-place truncation). ralph-meta.json is not touched.
 */
export function upsertLedgerFile(sessionDir: string, entry: VerificationLedgerEntry): void {
  mkdirSync(sessionDir, { recursive: true });
  const entries = readLedgerFile(sessionDir).filter(existing => !sameKey(existing, entry));
  entries.push(entry);
  const file: VerificationLedgerFile = { schema_version: 'verification-ledger/1.0', entries };
  const path = ledgerPath(sessionDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
  renameSync(tmp, path);
}
