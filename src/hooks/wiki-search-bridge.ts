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
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;

  try {
    // Fast path: try search daemon (no heavy imports)
    try {
      const { tryDaemonSearch } = await import('../search/daemon-client.js');
      const daemonResult = await tryDaemonSearch(workflowRoot, query, INTERNAL_LIMIT, false);
      if (daemonResult?.ok && daemonResult.results) {
        return { hits: toHits(daemonResult.results as RawHit[], limit, minScore), source: 'daemon' };
      }
    } catch {
      // Daemon unavailable — fall through to direct search
    }

    // Fallback: direct WikiIndexer BM25 search
    const indexer = await getIndexer(workflowRoot);
    const { results } = await indexer.searchWithMeta(query, INTERNAL_LIMIT, { skipEmbedding: true });
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
