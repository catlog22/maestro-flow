// src/graph/kg/credibility.ts — Knowledge credibility scoring
//
// Exponential decay with type-specific half-lives.
// Storage: credibility table in maestro.db (no FK CASCADE).
// Scoring: factor = floor + (1 - floor) * e^(-λ * age_days)

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredibilityRow {
  node_id: string;
  content_hash: string;
  search_hits: number;
  consumption_count: number;
  last_hit_at: number | null;
  last_consumed_at: number | null;
  content_changed_at: number;
  created_at: number;
}

export interface CredibilityConfig {
  floor: number;
  warningThreshold: number;
  halfLives: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Default config — half-lives in days, from Grill GRL-001
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CredibilityConfig = {
  floor: 0.3,
  warningThreshold: 0.5,
  halfLives: {
    domain: 180,
    spec: 60,
    knowhow: 30,
    issue: 14,
    project: 90,
    roadmap: 90,
    note: 90,
  },
};

// λ = ln(2) / half_life
const LN2 = Math.LN2;

// ---------------------------------------------------------------------------
// Schema v3 migration SQL
// ---------------------------------------------------------------------------

export const CREDIBILITY_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS credibility (
    node_id             TEXT PRIMARY KEY,
    content_hash        TEXT NOT NULL,
    search_hits         INTEGER NOT NULL DEFAULT 0,
    consumption_count   INTEGER NOT NULL DEFAULT 0,
    last_hit_at         INTEGER,
    last_consumed_at    INTEGER,
    content_changed_at  INTEGER NOT NULL,
    created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credibility_search_hits ON credibility(search_hits);
CREATE INDEX IF NOT EXISTS idx_credibility_content_changed ON credibility(content_changed_at);
`;

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

export function computeDecayFactor(
  ageDays: number,
  nodeType: string,
  config: CredibilityConfig = DEFAULT_CONFIG,
): number {
  const halfLife = config.halfLives[nodeType] ?? 60;
  const lambda = LN2 / halfLife;
  // Raw max is 1 (at age 0) — no ceiling needed.
  return config.floor + (1 - config.floor) * Math.exp(-lambda * ageDays);
}

export function computeCredibilityFactor(
  row: CredibilityRow | null,
  nodeType: string,
  nowMs: number = Date.now(),
  config: CredibilityConfig = DEFAULT_CONFIG,
): number {
  if (!row) return 1.0;
  const ageDays = (nowMs - row.content_changed_at) / 86_400_000;
  return computeDecayFactor(Math.max(0, ageDays), nodeType, config);
}

export function isLowCredibility(
  factor: number,
  config: CredibilityConfig = DEFAULT_CONFIG,
): boolean {
  return factor < config.warningThreshold;
}

export function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

export class CredibilityStore {
  constructor(private db: DatabaseSync) {}

  upsert(nodeId: string, hash: string, nowMs: number = Date.now()): void {
    this.db.prepare(`
      INSERT INTO credibility (node_id, content_hash, content_changed_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        content_hash = excluded.content_hash,
        content_changed_at = CASE
          WHEN credibility.content_hash != excluded.content_hash THEN excluded.content_changed_at
          ELSE credibility.content_changed_at
        END
    `).run(nodeId, hash, nowMs, nowMs);
  }

  get(nodeId: string): CredibilityRow | null {
    return this.db.prepare(
      'SELECT * FROM credibility WHERE node_id = ?'
    ).get(nodeId) as unknown as CredibilityRow | null;
  }

  getMany(nodeIds: string[]): Map<string, CredibilityRow> {
    if (nodeIds.length === 0) return new Map();
    const placeholders = nodeIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM credibility WHERE node_id IN (${placeholders})`
    ).all(...nodeIds) as unknown as CredibilityRow[];
    const map = new Map<string, CredibilityRow>();
    for (const r of rows) map.set(r.node_id, r);
    return map;
  }

  getAll(): CredibilityRow[] {
    return this.db.prepare('SELECT * FROM credibility').all() as unknown as CredibilityRow[];
  }

  incrementSearchHits(nodeIds: string[], nowMs: number = Date.now()): void {
    if (nodeIds.length === 0) return;
    const stmt = this.db.prepare(
      'UPDATE credibility SET search_hits = search_hits + 1, last_hit_at = ? WHERE node_id = ?'
    );
    for (const id of nodeIds) stmt.run(nowMs, id);
  }

  incrementConsumption(nodeId: string, nowMs: number = Date.now()): void {
    this.db.prepare(
      'UPDATE credibility SET consumption_count = consumption_count + 1, last_consumed_at = ? WHERE node_id = ?'
    ).run(nowMs, nodeId);
  }

  cleanOrphans(): number {
    const result = this.db.prepare(
      'DELETE FROM credibility WHERE node_id NOT IN (SELECT id FROM nodes)'
    ).run();
    return Number(result.changes);
  }
}

// ---------------------------------------------------------------------------
// ID namespace bridge: WikiEntry ID ↔ KG node ID
// WikiEntry: "type-slug" (e.g. "knowhow-KNW-20260501-auth")
// KG node:   "prefix:slug" (e.g. "knowhow:KNW-20260501-auth")
// ---------------------------------------------------------------------------

const WIKI_TYPE_TO_KG_PREFIX: Record<string, string> = {
  spec: 'spec', knowhow: 'knowhow', issue: 'issue',
  domain: 'domain', project: 'codebase', roadmap: 'codebase', note: 'codebase',
};

export function wikiIdToNodeId(wikiId: string): string | null {
  const dash = wikiId.indexOf('-');
  if (dash <= 0) return null;
  const type = wikiId.slice(0, dash);
  const slug = wikiId.slice(dash + 1);
  const prefix = WIKI_TYPE_TO_KG_PREFIX[type];
  return prefix ? `${prefix}:${slug}` : null;
}

// ---------------------------------------------------------------------------
// Export config for external use
// ---------------------------------------------------------------------------

export { DEFAULT_CONFIG as CREDIBILITY_DEFAULT_CONFIG };
