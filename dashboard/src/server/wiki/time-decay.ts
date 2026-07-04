/**
 * Time-based decay for search ranking.
 *
 * Self-contained mirror of the exponential decay model in
 * src/graph/kg/credibility.ts — but with NO SQLite dependency. Each entry's
 * own date drives the decay, so this runs entirely inside the wiki layer.
 *
 *   factor = floor + (1 - floor) * e^(-λ * age_days),   λ = ln2 / half_life
 *
 * Applied as the final multiplier in WikiIndexer.searchWithMeta, after BM25
 * and hybrid fusion — so fresh knowledge outranks stale knowledge uniformly
 * across both retrieval paths.
 */

import type { WikiEntry } from './wiki-types.js';

/** Lowest weight an infinitely old entry decays to (never fully sinks). */
const FLOOR = 0.3;
const LN2 = Math.LN2;
const DAY_MS = 86_400_000;

/** Half-lives in days by wiki node type. Mirrors credibility.ts DEFAULT_CONFIG. */
const HALF_LIVES: Record<string, number> = {
  domain: 180,
  spec: 60,
  knowhow: 30,
  issue: 14,
  project: 90,
  roadmap: 90,
  note: 90,
};

const DEFAULT_HALF_LIFE = 60;

/**
 * Resolve the most representative timestamp for an entry.
 * Priority: ext.timestamp (spec/knowhow `date` attribute) > updated (fs mtime).
 * Returns epoch ms, or null when unparseable (→ no decay applied).
 */
function entryDateMs(entry: WikiEntry): number | null {
  const ts = entry.ext?.timestamp;
  if (typeof ts === 'string' && ts.length > 0) {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) return ms;
  }
  if (entry.updated) {
    const ms = Date.parse(entry.updated);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Compute the decay multiplier for a single entry at time `nowMs`. */
export function computeTimeDecayFactor(entry: WikiEntry, nowMs: number): number {
  const dateMs = entryDateMs(entry);
  if (dateMs === null) return 1.0;
  const ageDays = Math.max(0, (nowMs - dateMs) / DAY_MS);
  const halfLife = HALF_LIVES[entry.type] ?? DEFAULT_HALF_LIFE;
  const lambda = LN2 / halfLife;
  return FLOOR + (1 - FLOOR) * Math.exp(-lambda * ageDays);
}

/**
 * Multiply each result's score by its time-decay factor and re-sort in place.
 * Ties break by descending original position is not preserved — sort is stable
 * on score only, matching the BM25 layer's convention.
 */
export function applyTimeDecay(
  results: Array<{ entry: WikiEntry; score: number }>,
  nowMs: number,
): Array<{ entry: WikiEntry; score: number }> {
  for (const r of results) {
    r.score *= computeTimeDecayFactor(r.entry, nowMs);
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
