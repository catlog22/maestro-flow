import type { WikiEntry } from './wiki-types.js';

/**
 * BM25-lite full-text search.
 * k1 and b are the standard Lucene defaults. Tweak if ranking feels off.
 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
  'is', 'it', 'with', 'as', 'at', 'by', 'be', 'are', 'was', 'were',
  'this', 'that', 'from', 'but', 'not',
]);

export interface Posting {
  docId: string;
  tf: number;
}

export interface InvertedIndex {
  postings: Map<string, Posting[]>;
  docLengths: Map<string, number>;
  avgDocLength: number;
  totalDocs: number;
}

export interface SearchResult {
  docId: string;
  score: number;
}

/**
 * Tokenize into lowercase terms. Strips non-word chars, drops tokens shorter
 * than 2 characters, and filters a tiny English stop-word set.
 *
 * CJK characters are not split by this regex; callers searching Chinese
 * corpora should feed substrings directly — ranking is approximate then.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (p.length < 2) continue;
    if (STOP_WORDS.has(p)) continue;
    out.push(p);
  }
  return out;
}

function documentText(entry: WikiEntry): string {
  return [
    entry.title,
    entry.summary,
    entry.tags.join(' '),
    entry.category ?? '',
    entry.body,
  ].join(' ');
}

export function buildInvertedIndex(entries: WikiEntry[]): InvertedIndex {
  const postings = new Map<string, Posting[]>();
  const docLengths = new Map<string, number>();
  let totalLength = 0;

  for (const entry of entries) {
    const tokens = tokenize(documentText(entry));
    docLengths.set(entry.id, tokens.length);
    totalLength += tokens.length;

    const termCounts = new Map<string, number>();
    for (const t of tokens) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);

    for (const [term, tf] of termCounts) {
      let list = postings.get(term);
      if (!list) {
        list = [];
        postings.set(term, list);
      }
      list.push({ docId: entry.id, tf });
    }
  }

  const totalDocs = entries.length;
  const avgDocLength = totalDocs === 0 ? 0 : totalLength / totalDocs;

  return { postings, docLengths, avgDocLength, totalDocs };
}

/**
 * BM25 score for a single query against a pre-built inverted index.
 * Returns results sorted by score descending, limited to `limit`.
 */
export function searchBM25(
  index: InvertedIndex,
  query: string,
  limit = 50,
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.totalDocs === 0) return [];

  const scores = new Map<string, number>();
  for (const term of terms) {
    const postings = index.postings.get(term);
    if (!postings || postings.length === 0) continue;

    // BM25 idf: ln(1 + (N - df + 0.5) / (df + 0.5))
    const df = postings.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));

    for (const { docId, tf } of postings) {
      const dl = index.docLengths.get(docId) ?? 0;
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / (index.avgDocLength || 1));
      const termScore = idf * ((tf * (BM25_K1 + 1)) / (denom || 1));
      scores.set(docId, (scores.get(docId) ?? 0) + termScore);
    }
  }

  const ranked: SearchResult[] = [];
  for (const [docId, score] of scores) ranked.push({ docId, score });
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return ranked.slice(0, limit);
}
