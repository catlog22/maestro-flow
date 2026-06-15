import type { WikiEntry } from './wiki-types.js';

/**
 * BM25F full-text search with per-field boosting.
 *
 * Uses true field-level term frequencies with independent B parameters per
 * field, replacing the previous approach of repeating title/tags strings to
 * simulate boosting (which distorted avgDocLength and TF distributions).
 */
const BM25_K1 = 1.5;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
  'is', 'it', 'with', 'as', 'at', 'by', 'be', 'are', 'was', 'were',
  'this', 'that', 'from', 'but', 'not',
]);

// ---------------------------------------------------------------------------
// Field configuration
// ---------------------------------------------------------------------------

type FieldName = 'title' | 'summary' | 'tags' | 'body';

interface FieldConfig {
  boost: number;
  b: number;
}

const FIELD_CONFIGS: Record<FieldName, FieldConfig> = {
  title:   { boost: 3,   b: 0.3  },
  summary: { boost: 1.5, b: 0.75 },
  tags:    { boost: 2,   b: 0    },
  body:    { boost: 1,   b: 0.75 },
};

const KG_FIELD_CONFIGS: Record<FieldName, FieldConfig> = {
  title:   { boost: 2, b: 0.3 },
  summary: { boost: 0, b: 0   },
  tags:    { boost: 1, b: 0   },
  body:    { boost: 0, b: 0   },
};

// ---------------------------------------------------------------------------
// Public types — kept unchanged for backward compatibility
// ---------------------------------------------------------------------------

export interface Posting {
  docId: string;
  tf: number;
}

export interface InvertedIndex {
  postings: Map<string, Posting[]>;
  docLengths: Map<string, number>;
  avgDocLength: number;
  totalDocs: number;
  /** BM25F internals — opaque to external consumers. */
  _fieldPostings?: Map<string, FieldPosting[]>;
  _fieldLengths?: Map<string, FieldLengths>;
  _avgFieldLengths?: FieldLengths;
}

export interface SearchResult {
  docId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Internal BM25F types
// ---------------------------------------------------------------------------

type FieldLengths = Record<FieldName, number>;

interface FieldPosting {
  docId: string;
  fieldTfs: Record<FieldName, number>;
}

// ---------------------------------------------------------------------------
// CJK support
// ---------------------------------------------------------------------------

const CJK_RUN = /[一-鿿㐀-䶿]+/g;
const HAS_CJK = /[一-鿿㐀-䶿]/;

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

export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (!p) continue;
    if (HAS_CJK.test(p)) {
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

// ---------------------------------------------------------------------------
// Field text extraction
// ---------------------------------------------------------------------------

function isKgVirtual(entry: WikiEntry): boolean {
  const vk = entry.ext?.virtualKind;
  return vk === 'kg-node' || vk === 'kg-layer' || vk === 'kg-tour-step';
}

function extractFieldTexts(entry: WikiEntry): Record<FieldName, string> {
  return {
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags.join(' ') + (entry.category ? ' ' + entry.category : ''),
    body: entry.body,
  };
}

function getFieldConfigs(entry: WikiEntry): Record<FieldName, FieldConfig> {
  return isKgVirtual(entry) ? KG_FIELD_CONFIGS : FIELD_CONFIGS;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

export function buildInvertedIndex(entries: WikiEntry[]): InvertedIndex {
  const fieldPostings = new Map<string, FieldPosting[]>();
  const fieldLengths = new Map<string, FieldLengths>();

  // Legacy flat postings + docLengths for backward-compat consumers
  const postings = new Map<string, Posting[]>();
  const docLengths = new Map<string, number>();
  let totalLength = 0;

  const totalFieldLengths: FieldLengths = { title: 0, summary: 0, tags: 0, body: 0 };
  const fields: FieldName[] = ['title', 'summary', 'tags', 'body'];

  for (const entry of entries) {
    const texts = extractFieldTexts(entry);
    const configs = getFieldConfigs(entry);

    const perField: Record<FieldName, Map<string, number>> = {
      title: new Map(), summary: new Map(), tags: new Map(), body: new Map(),
    };
    const lengths: FieldLengths = { title: 0, summary: 0, tags: 0, body: 0 };

    const flatTermCounts = new Map<string, number>();

    for (const f of fields) {
      if (configs[f].boost === 0) continue;
      const tokens = tokenize(texts[f]);
      lengths[f] = tokens.length;
      totalFieldLengths[f] += tokens.length;
      for (const t of tokens) {
        perField[f].set(t, (perField[f].get(t) ?? 0) + 1);
        flatTermCounts.set(t, (flatTermCounts.get(t) ?? 0) + 1);
      }
    }

    fieldLengths.set(entry.id, lengths);

    // Build field-level postings
    const allTerms = new Set<string>();
    for (const f of fields) {
      for (const t of perField[f].keys()) allTerms.add(t);
    }
    for (const term of allTerms) {
      let list = fieldPostings.get(term);
      if (!list) { list = []; fieldPostings.set(term, list); }
      list.push({
        docId: entry.id,
        fieldTfs: {
          title: perField.title.get(term) ?? 0,
          summary: perField.summary.get(term) ?? 0,
          tags: perField.tags.get(term) ?? 0,
          body: perField.body.get(term) ?? 0,
        },
      });
    }

    // Flat postings for legacy compatibility
    const flatTotal = [...flatTermCounts.values()].reduce((a, b) => a + b, 0);
    docLengths.set(entry.id, flatTotal);
    totalLength += flatTotal;
    for (const [term, tf] of flatTermCounts) {
      let list = postings.get(term);
      if (!list) { list = []; postings.set(term, list); }
      list.push({ docId: entry.id, tf });
    }
  }

  const totalDocs = entries.length;
  const avgFieldLengths: FieldLengths = {
    title: totalDocs ? totalFieldLengths.title / totalDocs : 0,
    summary: totalDocs ? totalFieldLengths.summary / totalDocs : 0,
    tags: totalDocs ? totalFieldLengths.tags / totalDocs : 0,
    body: totalDocs ? totalFieldLengths.body / totalDocs : 0,
  };

  return {
    postings,
    docLengths,
    avgDocLength: totalDocs === 0 ? 0 : totalLength / totalDocs,
    totalDocs,
    _fieldPostings: fieldPostings,
    _fieldLengths: fieldLengths,
    _avgFieldLengths: avgFieldLengths,
  };
}

// ---------------------------------------------------------------------------
// BM25F scoring
// ---------------------------------------------------------------------------

export function searchBM25(
  index: InvertedIndex,
  query: string,
  limit = 50,
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.totalDocs === 0) return [];

  // Use BM25F when field data is available, otherwise fall back to flat BM25
  if (index._fieldPostings && index._fieldLengths && index._avgFieldLengths) {
    return searchBM25F(index, terms, limit);
  }
  return searchBM25Flat(index, terms, limit);
}

function searchBM25F(index: InvertedIndex, terms: string[], limit: number): SearchResult[] {
  const fp = index._fieldPostings!;
  const fl = index._fieldLengths!;
  const afl = index._avgFieldLengths!;
  const fields: FieldName[] = ['title', 'summary', 'tags', 'body'];

  const scores = new Map<string, number>();
  for (const term of terms) {
    const postings = fp.get(term);
    if (!postings || postings.length === 0) continue;

    const df = postings.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));

    for (const { docId, fieldTfs } of postings) {
      const docFL = fl.get(docId);
      if (!docFL) continue;

      // BM25F: compute weighted pseudo-TF across all fields
      let tfTilde = 0;
      for (const f of fields) {
        const boost = FIELD_CONFIGS[f].boost;
        const b = FIELD_CONFIGS[f].b;
        if (boost === 0 || fieldTfs[f] === 0) continue;
        const norm = 1 - b + b * (docFL[f] / (afl[f] || 1));
        tfTilde += boost * (fieldTfs[f] / (norm || 1));
      }

      const termScore = idf * ((tfTilde * (BM25_K1 + 1)) / (tfTilde + BM25_K1));
      scores.set(docId, (scores.get(docId) ?? 0) + termScore);
    }
  }

  const ranked: SearchResult[] = [];
  for (const [docId, score] of scores) ranked.push({ docId, score });
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return ranked.slice(0, limit);
}

function searchBM25Flat(index: InvertedIndex, terms: string[], limit: number): SearchResult[] {
  const scores = new Map<string, number>();
  for (const term of terms) {
    const postings = index.postings.get(term);
    if (!postings || postings.length === 0) continue;

    const df = postings.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));

    for (const { docId, tf } of postings) {
      const dl = index.docLengths.get(docId) ?? 0;
      const denom = tf + BM25_K1 * (1 - BM25_K1 + (BM25_K1 * dl) / (index.avgDocLength || 1));
      const termScore = idf * ((tf * (BM25_K1 + 1)) / (denom || 1));
      scores.set(docId, (scores.get(docId) ?? 0) + termScore);
    }
  }

  const ranked: SearchResult[] = [];
  for (const [docId, score] of scores) ranked.push({ docId, score });
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return ranked.slice(0, limit);
}
