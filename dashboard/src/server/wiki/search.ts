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

// CJK character range: CJK Unified Ideographs + CJK Extension A.
// Used to detect runs that need n-gram splitting (BM25 can't match
// otherwise — a single 4-char Chinese term would never overlap a 2-char
// query substring). Hiragana/katakana/hangul are out of scope for now.
const CJK_RUN = /[一-鿿㐀-䶿]+/g;
const HAS_CJK = /[一-鿿㐀-䶿]/;

/**
 * Extract 2- and 3-char n-grams from a CJK run. 2/3 covers the majority of
 * Chinese terms while keeping the inverted index size bounded; 4+ grams
 * explode postings without proportional recall gain.
 */
function cjkNgrams(run: string): string[] {
  const out: string[] = [];
  for (let n = 2; n <= 3; n++) {
    if (run.length < n) break;
    for (let i = 0; i <= run.length - n; i++) {
      out.push(run.substring(i, i + n));
    }
  }
  return out;
}

/**
 * Tokenize into lowercase terms. Strategy:
 *   1. Lowercase, split on non-word chars (\p{L}\p{N})
 *   2. For each chunk: if contains CJK → emit 2/3-char n-grams; otherwise
 *      keep the chunk if it passes length + stop-word filters.
 *
 * Query and document use the same function so n-grams from both sides
 * intersect in the inverted index → BM25 ranking works for CJK corpora.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (!p) continue;
    if (HAS_CJK.test(p)) {
      // A chunk may mix CJK and Latin (e.g. "用户auth"); slice each CJK run
      // for n-gram emission and keep any Latin remainder as its own token.
      const cjkRuns = p.match(CJK_RUN) ?? [];
      for (const run of cjkRuns) {
        for (const g of cjkNgrams(run)) out.push(g);
      }
      const latinRemainder = p.replace(CJK_RUN, ' ').split(/\s+/).filter(Boolean);
      for (const lr of latinRemainder) {
        if (lr.length >= 2 && !STOP_WORDS.has(lr)) out.push(lr);
      }
    } else {
      if (p.length < 2) continue;
      if (STOP_WORDS.has(p)) continue;
      out.push(p);
    }
  }
  return out;
}

function documentText(entry: WikiEntry): string {
  return [
    entry.title, entry.title, entry.title,  // 3x title weight
    entry.summary,
    entry.tags.join(' '), entry.tags.join(' '),  // 2x tags weight
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
