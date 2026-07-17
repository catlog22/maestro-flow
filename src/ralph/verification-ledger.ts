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

import { z } from 'zod';
import { join } from 'node:path';
import { SessionStore } from '../run/store.js';
import type { VerificationLedgerEntry } from './status-schema.js';

const verificationLedgerEntrySchema = z.object({
  authority: z.string(),
  dimension: z.string(),
  subject_ids: z.array(z.string()),
  evidence_hashes: z.record(z.string(), z.string()),
  scope_hash: z.string(),
  verdict: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  concerns: z.string().nullable().optional(),
  risk_ceiling: z.enum(['low', 'medium', 'high']),
  created_at: z.string(),
}).strict();

const verificationLedgerFileSchema = z.object({
  schema_version: z.literal('verification-ledger/1.0'),
  entries: z.array(verificationLedgerEntrySchema),
}).strict();

type VerificationLedgerFile = z.infer<typeof verificationLedgerFileSchema>;

function ledgerPath(store: SessionStore, sessionId: string): string {
  return join(store.sessionDir(sessionId), 'verification-ledger.json');
}

/** Read the independent verification-ledger.json (empty when absent; corrupt data fails closed). */
export function readLedgerFile(projectRoot: string, sessionId: string): VerificationLedgerEntry[] {
  const store = new SessionStore(projectRoot);
  const initial: VerificationLedgerFile = { schema_version: 'verification-ledger/1.0', entries: [] };
  return store.readJsonFile(ledgerPath(store, sessionId), verificationLedgerFileSchema, initial).entries;
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
  projectRoot: string,
  sessionId: string,
  legacy: VerificationLedgerEntry[],
): VerificationLedgerEntry[] {
  const fileEntries = readLedgerFile(projectRoot, sessionId);
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
export function upsertLedgerFile(
  projectRoot: string,
  sessionId: string,
  entry: VerificationLedgerEntry,
): void {
  const store = new SessionStore(projectRoot);
  verificationLedgerEntrySchema.parse(entry);
  const initial: VerificationLedgerFile = { schema_version: 'verification-ledger/1.0', entries: [] };
  store.updateJsonFile(ledgerPath(store, sessionId), verificationLedgerFileSchema, initial, draft => {
    draft.entries = draft.entries.filter(existing => !sameKey(existing, entry));
    draft.entries.push(entry);
  });
}
