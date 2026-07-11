import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { RalphSession, VerificationLedgerEntry } from './status-schema.js';
import { resolveSession, writeStatus, workflowRoot } from './status-store.js';

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
  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    console.error(`[ralph ledger] no session found with id "${opts.sessionId}" in .workflow/.maestro/`);
    return 1;
  }
  const { statusPath, data } = resolved;

  if (opts.action === 'query') {
    return handleQuery(data, opts);
  } else {
    return handleAdd(data, statusPath, opts);
  }
}

function handleQuery(session: RalphSession, opts: LedgerCmdOptions): number {
  const ledger = session.verification_ledger ?? [];
  
  // Find a matching entry: same authority, dimension, and subjects list (ignoring order)
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

  // Verify risk ceiling
  const riskLevels = { low: 1, medium: 2, high: 3 };
  const requestedRisk = opts.riskCeiling ? riskLevels[opts.riskCeiling] : 1;
  const recordedRisk = riskLevels[entry.risk_ceiling] ?? 1;
  if (requestedRisk > recordedRisk) {
    console.log(`[ralph ledger] rejected: risk ceiling ${entry.risk_ceiling} is below requested risk ${opts.riskCeiling}`);
    return 1;
  }

  // Verify confidence (advisory decisions, low confidence are rejected for fast path)
  if (entry.confidence === 'low') {
    console.log('[ralph ledger] rejected: recorded confidence is low');
    return 1;
  }

  // Verify verdict is successful
  if (entry.verdict !== 'pass' && entry.verdict !== 'success' && entry.verdict !== 'DONE') {
    console.log(`[ralph ledger] rejected: recorded verdict is "${entry.verdict}" (not pass/success)`);
    return 1;
  }

  // Check concerns
  if (entry.concerns) {
    console.log(`[ralph ledger] rejected: entry contains concerns: "${entry.concerns}"`);
    return 1;
  }

  // Verify scope hash (boundary_contract)
  const currentScopeHash = computeScopeHash(session);
  if (currentScopeHash !== entry.scope_hash) {
    console.log('[ralph ledger] rejected: scope_hash changed (boundary contract modified)');
    return 1;
  }

  // Verify evidence hashes (subjects)
  for (const subject of opts.subjects) {
    const recordedHash = entry.evidence_hashes[subject];
    const currentHash = computeFileHash(subject);
    if (currentHash !== recordedHash) {
      console.log(`[ralph ledger] rejected: hash changed for subject "${subject}" (got "${currentHash}", recorded "${recordedHash}")`);
      return 1;
    }
  }

  console.log(`[ralph ledger] HIT: verdict="${entry.verdict}" confidence="${entry.confidence}"`);
  return 0;
}

function handleAdd(session: RalphSession, statusPath: string, opts: LedgerCmdOptions): number {
  if (!opts.verdict) {
    console.error('[ralph ledger] error: --verdict is required for add action');
    return 1;
  }

  const scopeHash = computeScopeHash(session);
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

  session.verification_ledger = session.verification_ledger ?? [];
  
  // Remove any pre-existing entry with same authority, dimension, and subjects
  session.verification_ledger = session.verification_ledger.filter(e => {
    if (e.authority !== opts.authority) return true;
    if (e.dimension !== opts.dimension) return true;
    const s1 = [...e.subject_ids].sort();
    const s2 = [...opts.subjects].sort();
    if (s1.length !== s2.length) return true;
    return !s1.every((val, i) => val === s2[i]);
  });

  session.verification_ledger.push(entry);
  writeStatus(statusPath, session);

  console.log(`[ralph ledger] entry added successfully for subjects: ${opts.subjects.join(', ')}`);
  return 0;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function computeFileHash(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  try {
    const content = readFileSync(filePath);
    return computeHash(content.toString('utf8'));
  } catch {
    return 'error';
  }
}

function computeScopeHash(session: RalphSession): string {
  const boundary = session.boundary_contract ?? {};
  const str = JSON.stringify({
    in_scope: boundary.in_scope ?? [],
    out_of_scope: boundary.out_of_scope ?? [],
    constraints: boundary.constraints ?? [],
    definition_of_done: boundary.definition_of_done ?? '',
  });
  return computeHash(str);
}
