/**
 * Wiki Search Bridge — hot-path helper for keyword spec injection.
 *
 * Provides a best-effort wiki search that never throws: tries the resident
 * search daemon first (no heavy imports), falls back to a lazily-loaded
 * WikiIndexer BM25 search. Results are filtered to spec + knowhow entries,
 * score-thresholded, and capped.
 */

import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import { isDeprecatedKnowledgeEntry } from '../utils/knowledge-lifecycle.js';

export interface WikiSearchHit {
  id: string;
  type: string;
  title: string;
  summary: string;
  score: number;
}

export type WikiSearchSource = 'daemon' | 'indexer' | 'none';

const ALLOWED_TYPES = new Set(['spec', 'knowhow']);
const INTERNAL_LIMIT = 10;
const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_SCORE = 1.0;
/** Hybrid mode: keep hits scoring at least this fraction of the top hit. */
const HYBRID_RELATIVE_FACTOR = 0.4;
/** Scale heuristic: hybrid scores are ≤ ~1.2 while BM25 raw scores run far higher. */
const HYBRID_SCALE_CUTOFF = 1.5;

// --- Cached WikiIndexer (lazy, only loaded when daemon is unavailable) ---

let _indexer: WikiIndexer | null = null;
let _indexerRoot: string | null = null;

async function getIndexer(workflowRoot: string): Promise<WikiIndexer> {
  if (_indexer && _indexerRoot === workflowRoot) return _indexer;
  const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
  _indexer = new Cls({ workflowRoot });
  _indexerRoot = workflowRoot;
  return _indexer;
}

interface RawHit {
  entry: {
    id: string;
    type: string;
    title?: string;
    summary?: string;
    status?: string;
    ext?: { status?: string };
  };
  score: number;
}

/**
 * Resolve the score threshold for a daemon response.
 *
 * Daemon hybrid scores are normalized (≤ ~1.2×decay) while BM25-only raw
 * scores commonly exceed 5 — a fixed absolute threshold silently empties
 * results whenever embedding is active. Hybrid mode uses a relative cut
 * against the top score; BM25 keeps the absolute default. When the response
 * does not report `embeddingUsed`, infer the mode from the score scale.
 */
function adaptiveMinScore(raw: RawHit[], embeddingUsed?: boolean): number {
  const top = raw.reduce((m, r) => Math.max(m, r.score), 0);
  if (top <= 0) return DEFAULT_MIN_SCORE;
  const hybrid = embeddingUsed ?? top < HYBRID_SCALE_CUTOFF;
  return hybrid ? HYBRID_RELATIVE_FACTOR * top : DEFAULT_MIN_SCORE;
}

function toHits(raw: RawHit[], limit: number, minScore: number): WikiSearchHit[] {
  return raw
    .filter((r) =>
      ALLOWED_TYPES.has(r.entry.type)
      && !isDeprecatedKnowledgeEntry(r.entry)
      && r.score >= minScore
    )
    .slice(0, limit)
    .map((r) => ({
      id: r.entry.id,
      type: r.entry.type,
      title: r.entry.title || 'Untitled',
      summary: (r.entry.summary || '').slice(0, 200),
      score: r.score,
    }));
}

/**
 * Search the wiki knowledge base. Best-effort — never throws.
 * Returns filtered spec + knowhow hits and the source that produced them.
 */
export async function searchWiki(
  workflowRoot: string,
  query: string,
  opts?: { limit?: number; minScore?: number },
): Promise<{ hits: WikiSearchHit[]; source: WikiSearchSource }> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  try {
    // Fast path: try search daemon (no heavy imports)
    try {
      const { tryDaemonSearch } = await import('../search/daemon-client.js');
      const daemonResult = await tryDaemonSearch(workflowRoot, query, INTERNAL_LIMIT, false);
      if (daemonResult?.ok && daemonResult.results) {
        const raw = daemonResult.results as RawHit[];
        const minScore = opts?.minScore ?? adaptiveMinScore(raw, daemonResult.embeddingUsed);
        return { hits: toHits(raw, limit, minScore), source: 'daemon' };
      }
    } catch {
      // Daemon unavailable — fall through to direct search
    }

    // Fallback: direct WikiIndexer BM25 search (skipEmbedding → raw BM25 scale)
    const indexer = await getIndexer(workflowRoot);
    const { results } = await indexer.searchWithMeta(query, INTERNAL_LIMIT, { skipEmbedding: true });
    const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
    return { hits: toHits(results as RawHit[], limit, minScore), source: 'indexer' };
  } catch {
    return { hits: [], source: 'none' };
  }
}

/**
 * Fire-and-forget background init of the WikiIndexer so future searches
 * skip the cold-start cost. Never throws.
 */
export function prewarmWikiIndexer(workflowRoot: string): void {
  getIndexer(workflowRoot).catch(() => {});
}
