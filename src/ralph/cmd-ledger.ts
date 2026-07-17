// ---------------------------------------------------------------------------
// `maestro ralph ledger` — verification ledger interface.
//
// Queries and adds verification entries. M6 splits the ledger into its own
// session-scoped `verification-ledger.json`: writes land there (upsertLedgerFile),
// and reads merge that file with the legacy ralph-meta.verification_ledger so an
// un-migrated session's cached findings still resolve. ralph-meta.json is left
// untouched — no .bak rename, no destructive migration.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  resolveRalphSession,
  workflowRoot,
} from './session-adapter.js';
import { mergedLedger, upsertLedgerFile } from './verification-ledger.js';
import type { VerificationLedgerEntry } from './status-schema.js';

export interface LedgerCmdOptions {
  sessionId: string;
  action: 'query' | 'add';
  authority: string;
  dimension: string;
  subjects: string[];
  verdict?: string;
  confidence?: 'high' | 'medium' | 'low';
  concerns?: string;
  riskCeiling?: 'low' | 'medium' | 'high';
}

export async function runLedger(opts: LedgerCmdOptions): Promise<number> {
  const projectRoot = workflowRoot();
  const resolved = resolveRalphSession(projectRoot, opts.sessionId);
  if (!resolved) {
    console.error(`[ralph ledger] no ralph session found with id "${opts.sessionId}"`);
    return 1;
  }

  if (opts.action === 'query') {
    // Merge the independent verification-ledger.json with the legacy ralph-meta
    // ledger so both migrated and un-migrated sessions resolve.
    const ledger = mergedLedger(projectRoot, resolved.sessionId, resolved.meta.verification_ledger ?? []);
    return handleQuery(ledger, opts);
  }
  return handleAdd(projectRoot, resolved.sessionId, opts);
}

function handleQuery(ledger: VerificationLedgerEntry[], opts: LedgerCmdOptions): number {
  const entry = ledger.find(e => {
    if (e.authority !== opts.authority) return false;
    if (e.dimension !== opts.dimension) return false;
    const s1 = [...e.subject_ids].sort();
    const s2 = [...opts.subjects].sort();
    if (s1.length !== s2.length) return false;
    return s1.every((val, i) => val === s2[i]);
  });

  if (!entry) {
    console.log('[ralph ledger] no matching ledger entry found');
    return 1;
  }

  const riskLevels = { low: 1, medium: 2, high: 3 };
  const requestedRisk = opts.riskCeiling ? riskLevels[opts.riskCeiling] : 1;
  const recordedRisk = riskLevels[entry.risk_ceiling] ?? 1;
  if (requestedRisk > recordedRisk) {
    console.log(`[ralph ledger] rejected: risk ceiling ${entry.risk_ceiling} is below requested risk ${opts.riskCeiling}`);
    return 1;
  }

  if (entry.confidence === 'low') {
    console.log('[ralph ledger] rejected: recorded confidence is low');
    return 1;
  }

  if (entry.verdict !== 'pass' && entry.verdict !== 'success' && entry.verdict !== 'DONE') {
    console.log(`[ralph ledger] rejected: recorded verdict is "${entry.verdict}" (not pass/success)`);
    return 1;
  }

  if (entry.concerns) {
    console.log(`[ralph ledger] rejected: entry contains concerns: "${entry.concerns}"`);
    return 1;
  }

  const currentScopeHash = computeScopeHash(resolveRalphSession(workflowRoot(), opts.sessionId)!.bundle.session);
  if (currentScopeHash !== entry.scope_hash) {
    console.log('[ralph ledger] rejected: scope_hash changed (boundary contract modified)');
    return 1;
  }

  for (const subject of opts.subjects) {
    const recordedHash = entry.evidence_hashes[subject];
    const currentHash = computeFileHash(subject);
    if (currentHash !== recordedHash) {
      console.log(`[ralph ledger] rejected: hash changed for subject "${subject}"`);
      return 1;
    }
  }

  console.log(`[ralph ledger] HIT: verdict="${entry.verdict}" confidence="${entry.confidence}"`);
  return 0;
}

function handleAdd(projectRoot: string, sessionId: string, opts: LedgerCmdOptions): number {
  if (!opts.verdict) {
    console.error('[ralph ledger] error: --verdict is required for add action');
    return 1;
  }

  const resolved = resolveRalphSession(projectRoot, sessionId);
  if (!resolved) return 1;

  const scopeHash = computeScopeHash(resolved.bundle.session);
  const evidenceHashes: Record<string, string> = {};
  for (const subject of opts.subjects) {
    evidenceHashes[subject] = computeFileHash(subject);
  }

  const entry: VerificationLedgerEntry = {
    authority: opts.authority,
    dimension: opts.dimension,
    subject_ids: opts.subjects,
    evidence_hashes: evidenceHashes,
    scope_hash: scopeHash,
    verdict: opts.verdict,
    confidence: opts.confidence ?? 'medium',
    concerns: opts.concerns ?? null,
    risk_ceiling: opts.riskCeiling ?? 'low',
    created_at: new Date().toISOString(),
  };

  // Writes go to the independent verification-ledger.json (M6), which upserts by
  // authority + dimension + subject set. ralph-meta.json is not modified.
  upsertLedgerFile(projectRoot, sessionId, entry);

  console.log(`[ralph ledger] entry added successfully for subjects: ${opts.subjects.join(', ')}`);
  return 0;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function computeFileHash(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  try {
    return computeHash(readFileSync(filePath, 'utf8'));
  } catch {
    return 'error';
  }
}

function computeScopeHash(session: import('../run/schemas.js').SessionState): string {
  const bc = session.boundary_contract;
  const str = JSON.stringify({
    in_scope: bc.in_scope,
    out_of_scope: bc.out_of_scope,
    constraints: bc.constraints,
    definition_of_done: bc.definition_of_done,
  });
  return computeHash(str);
}
