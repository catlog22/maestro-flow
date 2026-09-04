import { createHash } from 'node:crypto';
import type { WikiEntry } from './wiki-types.js';
import {
  computeSearchCandidateBudget,
  isAdaptiveSearchBudgetEnabled,
} from '../../../../src/search/candidate-budget.js';
import type { SearchCandidateBudget } from '../../../../src/search/candidate-budget.js';

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
// Query expansion: synonyms + stem variants
// ---------------------------------------------------------------------------

const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['spec', ['specification', 'rule']],
  ['specification', ['spec']],
  ['auth', ['authentication', 'authorization', 'authorize']],
  ['authentication', ['auth']],
  ['authorization', ['auth']],
  ['config', ['configuration', 'settings']],
  ['configuration', ['config', 'settings']],
  ['settings', ['config', 'configuration']],
  ['deploy', ['deployment', 'release', 'publish']],
  ['deployment', ['deploy']],
  ['release', ['publish', 'deploy']],
  ['publish', ['release', 'deploy']],
  ['bug', ['defect', 'issue', 'fix']],
  ['error', ['exception', 'failure', 'fault']],
  ['exception', ['error']],
  ['test', ['testing', 'verify', 'assertion']],
  ['testing', ['test']],
  ['hook', ['hooks', 'lifecycle', 'callback']],
  ['delegate', ['delegation', 'dispatch']],
  ['delegation', ['delegate']],
  ['workflow', ['pipeline', 'orchestration']],
  ['pipeline', ['workflow']],
  ['knowledge', ['knowhow', 'wiki']],
  ['knowhow', ['knowledge']],
  ['wiki', ['knowledge']],
  ['command', ['cmd', 'cli']],
  ['cli', ['command']],
  ['component', ['module', 'widget']],
  ['module', ['component']],
]);

const STEM_SUFFIXES: ReadonlyArray<[RegExp, string]> = [
  [/ation$/, ''], [/tion$/, ''], [/sion$/, ''],
  [/ment$/, ''], [/ness$/, ''], [/ies$/, 'y'],
  [/ing$/, ''], [/ed$/, ''], [/er$/, ''],
  [/es$/, ''], [/s$/, ''],
];

function stemVariants(term: string): string[] {
  const variants: string[] = [];
  for (const [pattern, replacement] of STEM_SUFFIXES) {
    if (pattern.test(term)) {
      const stemmed = term.replace(pattern, replacement);
      if (stemmed.length >= 2 && stemmed !== term) variants.push(stemmed);
    }
  }
  return variants;
}

interface WeightedTerm {
  term: string;
  weight: number;
  coverageKey?: string;
}

// ---------------------------------------------------------------------------
// Coverage penalty types
// ---------------------------------------------------------------------------

export interface CoverageTerm {
  key: string;
  terms: string[];
  weight: number;
}

export interface CoveragePenaltyOptions {
  coreTerms: readonly CoverageTerm[];
  baseFactor?: number;
}

export function applyCoveragePenalty(
  score: number,
  matchedCoreWeight: number,
  totalCoreWeight: number,
  baseFactor = 0.65,
): number {
  if (totalCoreWeight === 0) return score;
  const coverage = matchedCoreWeight / totalCoreWeight;
  return score * (baseFactor + (1 - baseFactor) * coverage);
}

// ---------------------------------------------------------------------------
// QueryPlan types
// ---------------------------------------------------------------------------

export type QueryTermRole = 'anchor' | 'core' | 'context';

export interface QueryTokenClassification {
  raw: string;
  normalized: string;
  role: QueryTermRole;
  weight: number;
}

export interface QueryPlanGroup {
  role: QueryTermRole;
  weightedTerms: WeightedTerm[];
  rrfWeight: number;
}

export interface QueryPlan {
  rawQuery: string;
  tokens: QueryTokenClassification[];
  groups: QueryPlanGroup[];
  coreCoverageTerms: CoverageTerm[];
}

function expandQueryTerms(tokens: string[], index?: InvertedIndex): WeightedTerm[] {
  const seen = new Set<string>();
  const weighted: WeightedTerm[] = [];

  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    weighted.push({ term: t, weight: 1.0 });

    const syns = SYNONYMS.get(t);
    if (syns) {
      for (const s of syns) {
        const sTokens = tokenize(s);
        for (const st of sTokens) {
          if (!seen.has(st)) {
            seen.add(st);
            weighted.push({ term: st, weight: 0.3 });
          }
        }
      }
    }

    for (const v of stemVariants(t)) {
      if (!seen.has(v)) {
        seen.add(v);
        weighted.push({ term: v, weight: 0.5 });
      }
    }
  }

  // IDF-aware reweighting: boost specific terms, dampen generic ones in long queries
  if (index && tokens.length > 3) {
    const fp = index.fieldPostings;
    const N = index.totalDocs;
    if (N > 0) {
      const originals = weighted.filter(wt => wt.weight === 1.0);
      const idfs = originals.map(wt => {
        const df = fp.get(wt.term)?.length ?? 0;
        return Math.log(1 + (N - df + 0.5) / (df + 0.5));
      });
      if (idfs.length > 1) {
        const sorted = [...idfs].sort((a, b) => a - b);
        const medianIdf = sorted[Math.floor(sorted.length / 2)];
        for (let i = 0; i < originals.length; i++) {
          if (idfs[i] > medianIdf * 1.5) originals[i].weight = 1.3;
          else if (idfs[i] < medianIdf * 0.5) originals[i].weight = 0.7;
        }
      }
    }
  }

  return weighted;
}

// ---------------------------------------------------------------------------
// Field configuration
// ---------------------------------------------------------------------------

type FieldName = 'title' | 'summary' | 'tags' | 'body';

interface FieldConfig {
  boost: number;
  b: number;
}

const FIELD_CONFIGS: Record<FieldName, FieldConfig> = {
  title:   { boost: 5,   b: 0.3  },
  summary: { boost: 1.5, b: 0.75 },
  tags:    { boost: 3,   b: 0    },
  body:    { boost: 0.5, b: 0.75 },
};

const KG_FIELD_CONFIGS: Record<FieldName, FieldConfig> = {
  title:   { boost: 2, b: 0.3 },
  summary: { boost: 0, b: 0   },
  tags:    { boost: 1, b: 0   },
  body:    { boost: 0, b: 0   },
};

const SESSION_FIELD_CONFIGS: Record<FieldName, FieldConfig> = {
  title:   { boost: 2,   b: 0.3  },
  summary: { boost: 0.5, b: 0.75 },
  tags:    { boost: 1,   b: 0    },
  body:    { boost: 0.5, b: 0.75 },
};

// ---------------------------------------------------------------------------
// Public types — kept unchanged for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Legacy flat posting — kept for test backward compat only. */
export interface Posting {
  docId: string;
  tf: number;
}

export type FieldConfigKey = 'default' | 'kg' | 'session';

export interface InvertedIndex {
  /** @deprecated Legacy flat postings — not used by BM25F scoring. */
  postings: Map<string, Posting[]>;
  /** @deprecated Legacy flat doc lengths — not used by BM25F scoring. */
  docLengths: Map<string, number>;
  /** @deprecated Legacy flat avg doc length — not used by BM25F scoring. */
  avgDocLength: number;
  totalDocs: number;
  fieldPostings: Map<string, FieldPosting[]>;
  fieldLengths: Map<string, FieldLengths>;
  avgFieldLengths: FieldLengths;
  docConfigKeys: Map<string, FieldConfigKey>;
}

export interface SearchResult {
  docId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Internal BM25F types
// ---------------------------------------------------------------------------

export type FieldLengths = Record<FieldName, number>;

interface FieldPosting {
  docId: string;
  fieldTfs: Record<FieldName, number>;
}

/** JSON-safe representation of the BM25F acceleration index. */
export interface SerializedInvertedIndex {
  /** Stable payload marker; entries remain the canonical source of truth. */
  schemaVersion: 'bm25f/1';
  /** Explicit payload version for forward-compatible validation. */
  version: 1;
  totalDocs: number;
  avgFieldLengths: FieldLengths;
  fieldPostings: Array<readonly [string, Array<{
    docId: string;
    fieldTfs: FieldLengths;
  }>] >;
  fieldLengths: Array<readonly [string, FieldLengths]>;
  docConfigKeys: Array<readonly [string, FieldConfigKey]>;
  /** Optional publication metadata used to reject stale acceleration hints. */
  generation?: number;
  sourceFingerprint?: string;
  docIdFingerprint?: string;
  configFingerprint?: string;
}

export interface InvertedIndexSerializationMetadata {
  generation?: number;
  sourceFingerprint?: string;
}

export interface InvertedIndexValidationOptions {
  expectedGeneration?: number;
  expectedSourceFingerprint?: string;
  expectedDocIds?: ReadonlySet<string>;
  expectedDocConfigKeys?: ReadonlyMap<string, FieldConfigKey>;
}

const SERIALIZED_BM25F_VERSION = 1;
const MAX_COMPILED_TERMS = 1_000_000;
const MAX_COMPILED_POSTINGS = 4_000_000;
const MAX_COMPILED_DOCS = 1_000_000;
const MAX_COMPILED_STRING = 32_768;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validLengths(value: unknown): value is FieldLengths {
  if (!isRecord(value)) return false;
  for (const field of INDEX_FIELDS) {
    if (!finiteNonNegative(value[field]) || !Number.isSafeInteger(value[field])) return false;
  }
  return true;
}

function validAverageLengths(value: unknown): value is FieldLengths {
  if (!isRecord(value)) return false;
  for (const field of INDEX_FIELDS) {
    if (!finiteNonNegative(value[field])) return false;
  }
  return true;
}

function cloneLengths(value: FieldLengths): FieldLengths {
  return {
    title: value.title,
    summary: value.summary,
    tags: value.tags,
    body: value.body,
  };
}

function fingerprintPairs(pairs: ReadonlyArray<readonly [string, string]>): string {
  const hash = createHash('sha256');
  for (const [key, value] of pairs.slice().sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(key).update('\0').update(value).update('\0');
  }
  return hash.digest('hex');
}

/**
 * Serialize an in-memory BM25F index without Maps or prototype-bearing
 * objects. Arrays are used for deterministic output and compact JSON; term
 * and document IDs remain explicit so validation can reject duplicate keys.
 */
export function serializeInvertedIndex(
  index: InvertedIndex,
  metadata: InvertedIndexSerializationMetadata = {},
): SerializedInvertedIndex {
  const fieldPostings = [...index.fieldPostings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, postings]) => [
      term,
      postings
        .slice()
        .sort((left, right) => left.docId.localeCompare(right.docId))
        .map(posting => ({ docId: posting.docId, fieldTfs: cloneLengths(posting.fieldTfs) })),
    ] as const);
  const fieldLengths = [...index.fieldLengths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([docId, lengths]) => [docId, cloneLengths(lengths)] as const);
  const docConfigKeys = [...index.docConfigKeys.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([docId, configKey]) => [docId, configKey] as const);
  const docIdFingerprint = fingerprintPairs(fieldLengths.map(([docId]) => [docId, ''] as const));
  const configFingerprint = fingerprintPairs(docConfigKeys.map(([docId, configKey]) => [docId, configKey] as const));
  return {
    schemaVersion: 'bm25f/1',
    version: SERIALIZED_BM25F_VERSION,
    totalDocs: index.totalDocs,
    avgFieldLengths: cloneLengths(index.avgFieldLengths),
    fieldPostings,
    fieldLengths,
    docConfigKeys,
    ...(metadata.generation === undefined ? {} : { generation: metadata.generation }),
    ...(metadata.sourceFingerprint === undefined ? {} : { sourceFingerprint: metadata.sourceFingerprint }),
    docIdFingerprint,
    configFingerprint,
  };
}

/**
 * Validate and rehydrate a serialized BM25F index. Invalid acceleration data
 * returns null rather than throwing: callers must rebuild from WikiEntry[] so
 * a corrupt optional section can never hide canonical content.
 */
export function deserializeInvertedIndex(
  value: unknown,
  options: InvertedIndexValidationOptions = {},
): InvertedIndex | null {
  if (!isRecord(value)) return null;
  const schemaVersion = value.schemaVersion;
  const format = value.format;
  const version = value.version;
  const totalDocs = value.totalDocs;
  const avgFieldLengths = value.avgFieldLengths;
  const rawFieldPostings = value.fieldPostings;
  const rawFieldLengths = value.fieldLengths;
  const rawDocConfigKeys = value.docConfigKeys;
  const generation = value.generation;
  const sourceFingerprint = value.sourceFingerprint;
  const docIdFingerprint = value.docIdFingerprint;
  const configFingerprint = value.configFingerprint;
  if ((schemaVersion !== 'bm25f/1' && format !== 'bm25f')
    || (version !== SERIALIZED_BM25F_VERSION && schemaVersion !== 'bm25f/1')
    || typeof totalDocs !== 'number' || !Number.isSafeInteger(totalDocs)
    || totalDocs < 0 || totalDocs > MAX_COMPILED_DOCS
    || !validAverageLengths(avgFieldLengths)
    || !Array.isArray(rawFieldPostings)
    || !Array.isArray(rawFieldLengths)
    || !Array.isArray(rawDocConfigKeys)
    || (generation !== undefined && (typeof generation !== 'number' || !Number.isFinite(generation)))
    || (sourceFingerprint !== undefined
      && (typeof sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(sourceFingerprint)))
    || (docIdFingerprint !== undefined
      && (typeof docIdFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(docIdFingerprint)))
    || (configFingerprint !== undefined
      && (typeof configFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(configFingerprint)))
    || (options.expectedGeneration !== undefined && generation !== undefined
      && generation !== options.expectedGeneration)
    || (options.expectedSourceFingerprint !== undefined && sourceFingerprint !== undefined
      && sourceFingerprint !== options.expectedSourceFingerprint)
    || rawFieldPostings.length > MAX_COMPILED_TERMS
    || rawFieldLengths.length > MAX_COMPILED_DOCS
    || rawDocConfigKeys.length > MAX_COMPILED_DOCS) return null;
  const normalizedAvgFieldLengths = avgFieldLengths as FieldLengths;
  const normalizedFieldPostings = rawFieldPostings as unknown[];
  const normalizedFieldLengths = rawFieldLengths as unknown[];
  const normalizedDocConfigKeys = rawDocConfigKeys as unknown[];

  const fieldLengths = new Map<string, FieldLengths>();
  const totalFieldLengths: FieldLengths = { title: 0, summary: 0, tags: 0, body: 0 };
  for (const item of normalizedFieldLengths) {
    if (!Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || item[0].length === 0 || item[0].length > MAX_COMPILED_STRING
      || !validLengths(item[1]) || fieldLengths.has(item[0])) return null;
    const lengths = item[1] as FieldLengths;
    for (const field of INDEX_FIELDS) totalFieldLengths[field] += lengths[field];
    fieldLengths.set(item[0], cloneLengths(lengths));
  }

  const docConfigKeys = new Map<string, FieldConfigKey>();
  for (const item of normalizedDocConfigKeys) {
    if (!Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || item[0].length === 0 || item[0].length > MAX_COMPILED_STRING
      || (item[1] !== 'default' && item[1] !== 'kg' && item[1] !== 'session')
      || docConfigKeys.has(item[0])) return null;
    docConfigKeys.set(item[0], item[1] as FieldConfigKey);
  }

  const fieldPostings = new Map<string, FieldPosting[]>();
  let postingCount = 0;
  for (const item of normalizedFieldPostings) {
    if (!Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || item[0].length === 0 || item[0].length > MAX_COMPILED_STRING
      || !Array.isArray(item[1]) || fieldPostings.has(item[0])) return null;
    const postings: FieldPosting[] = [];
    const seenDocs = new Set<string>();
    const rawPostings = item[1] as unknown[];
    for (const posting of rawPostings) {
      postingCount++;
      if (postingCount > MAX_COMPILED_POSTINGS
        || !isRecord(posting)
        || typeof posting.docId !== 'string' || posting.docId.length === 0
        || posting.docId.length > MAX_COMPILED_STRING
        || seenDocs.has(posting.docId)
        || !fieldLengths.has(posting.docId)
        || !validLengths(posting.fieldTfs)) return null;
      const fieldTfs = posting.fieldTfs as FieldLengths;
      const fieldLengthsForDoc = fieldLengths.get(posting.docId)!;
      // A posting with no positive field frequency cannot affect scoring and
      // is almost certainly a damaged/truncated payload. Frequencies also
      // cannot exceed the token count recorded for their document/field.
      if (!INDEX_FIELDS.some(field => fieldTfs[field] > 0)
        || INDEX_FIELDS.some(field => fieldTfs[field] > fieldLengthsForDoc[field])) return null;
      seenDocs.add(posting.docId);
      postings.push({ docId: posting.docId, fieldTfs: cloneLengths(fieldTfs) });
    }
    fieldPostings.set(item[0], postings);
  }

  // Every searchable document has a field-length/config record in indexes
  // emitted by buildInvertedIndex. Rejecting mismatches keeps malformed IDs
  // from silently changing document-frequency statistics.
  if (fieldLengths.size !== totalDocs || docConfigKeys.size !== totalDocs) return null;
  for (const docId of fieldLengths.keys()) {
    if (!docConfigKeys.has(docId)) return null;
  }
  for (const field of INDEX_FIELDS) {
    const expectedAverage = totalDocs === 0 ? 0 : totalFieldLengths[field] / totalDocs;
    const difference = Math.abs(normalizedAvgFieldLengths[field] - expectedAverage);
    if (difference > Math.max(1e-9, Math.abs(expectedAverage) * 1e-12)) return null;
  }
  if (options.expectedDocIds !== undefined
    && (options.expectedDocIds.size !== fieldLengths.size
      || [...options.expectedDocIds].some(docId => !fieldLengths.has(docId)))) return null;
  if (options.expectedDocConfigKeys !== undefined
    && (options.expectedDocConfigKeys.size !== docConfigKeys.size
      || [...options.expectedDocConfigKeys].some(([docId, key]) => docConfigKeys.get(docId) !== key))) return null;
  if (docIdFingerprint !== undefined
    && docIdFingerprint !== fingerprintPairs([...fieldLengths.keys()].map(docId => [docId, ''] as const))) return null;
  if (configFingerprint !== undefined
    && configFingerprint !== fingerprintPairs([...docConfigKeys.entries()])) return null;

  return {
    postings: new Map(),
    docLengths: new Map(),
    avgDocLength: 0,
    totalDocs,
    fieldPostings,
    fieldLengths,
    avgFieldLengths: cloneLengths(normalizedAvgFieldLengths),
    docConfigKeys,
  };
}

/** Explicit aliases for callers that refer to the compiled BM25F format. */
export const serializeBM25FIndex = serializeInvertedIndex;
export const deserializeBM25FIndex = deserializeInvertedIndex;

// ---------------------------------------------------------------------------
// CJK support
// ---------------------------------------------------------------------------

const CJK_RUN = /[一-鿿㐀-䶿]+/g;
const HAS_CJK = /[一-鿿㐀-䶿]/;
const CAMEL_BOUNDARY = /[a-z][A-Z]|[A-Z]+[A-Z][a-z]/;

function cjkNgrams(run: string): string[] {
  const out: string[] = [];
  if (run.length === 1) {
    out.push(run);
    return out;
  }
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
  // Split preserving original case so camelCase boundaries are detectable
  const rawParts = text.split(/[^\p{L}\p{N}]+/u);
  for (const raw of rawParts) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (HAS_CJK.test(lower)) {
      const cjkRuns = lower.match(CJK_RUN) ?? [];
      for (const run of cjkRuns) {
        for (const g of cjkNgrams(run)) out.push(g);
      }
      const latinRemainder = lower.replace(CJK_RUN, ' ').split(/\s+/).filter(Boolean);
      for (const lr of latinRemainder) {
        if (lr.length >= 2 && !STOP_WORDS.has(lr)) out.push(lr);
      }
    } else {
      // Most prose tokens cannot contain either camel-case boundary. Avoid
      // allocating two replacement strings and an array for that common case.
      if (!CAMEL_BOUNDARY.test(raw)) {
        if (lower.length >= 2 && !STOP_WORDS.has(lower)) out.push(lower);
        continue;
      }
      // CamelCase split: "DetailedTopologySVG" → ["Detailed","Topology","SVG"]
      const camelParts = raw
        .replace(/([a-z])([A-Z])/g, '$1\x00$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\x00$2')
        .split('\x00');
      for (const cp of camelParts) {
        const lc = cp.toLowerCase();
        if (lc.length >= 2 && !STOP_WORDS.has(lc)) out.push(lc);
      }
      // Keep full joined form for exact identifier matching
      if (lower.length >= 2 && !STOP_WORDS.has(lower)) out.push(lower);
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

function isSessionEntry(entry: WikiEntry): boolean {
  const vk = entry.ext?.virtualKind;
  return vk === 'claude-session' || vk === 'codex-session';
}

function extractFieldTexts(entry: WikiEntry): Record<FieldName, string> {
  return {
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags.join(' ') + (entry.category ? ' ' + entry.category : ''),
    body: entry.body,
  };
}

function getFieldConfigKey(entry: WikiEntry): FieldConfigKey {
  if (isKgVirtual(entry)) return 'kg';
  if (isSessionEntry(entry)) return 'session';
  return 'default';
}

/** Resolve the field-configuration identity without building postings. */
export function getInvertedIndexConfigKey(entry: WikiEntry): FieldConfigKey {
  return getFieldConfigKey(entry);
}

const FIELD_CONFIG_MAP: Record<FieldConfigKey, Record<FieldName, FieldConfig>> = {
  default: FIELD_CONFIGS,
  kg: KG_FIELD_CONFIGS,
  session: SESSION_FIELD_CONFIGS,
};

function getFieldConfigs(entry: WikiEntry): Record<FieldName, FieldConfig> {
  return FIELD_CONFIG_MAP[getFieldConfigKey(entry)];
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

const INDEX_FIELDS: readonly FieldName[] = ['title', 'summary', 'tags', 'body'];

interface TokenStats {
  length: number;
  /** Terms remain in first-occurrence order to preserve posting order. */
  frequencies: Array<readonly [string, number]>;
}

export function buildInvertedIndex(entries: WikiEntry[]): InvertedIndex {
  const fieldPostings = new Map<string, FieldPosting[]>();
  const fieldLengths = new Map<string, FieldLengths>();
  const docConfigKeys = new Map<string, FieldConfigKey>();

  const totalFieldLengths: FieldLengths = { title: 0, summary: 0, tags: 0, body: 0 };
  // KG projections commonly share identical tag/category strings across
  // thousands of nodes. Cache exact build-local token statistics: every index
  // remains cold and independent, while duplicate field text is tokenized once.
  const tokenStatsCache = new Map<string, TokenStats>();
  const tokenStats = (text: string): TokenStats => {
    const cached = tokenStatsCache.get(text);
    if (cached) return cached;
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (const term of tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
    const stats = { length: tokens.length, frequencies: [...counts.entries()] };
    tokenStatsCache.set(text, stats);
    return stats;
  };

  for (const entry of entries) {
    const texts = extractFieldTexts(entry);
    const configKey = getFieldConfigKey(entry);
    const configs = FIELD_CONFIG_MAP[configKey];
    docConfigKeys.set(entry.id, configKey);

    const termFields = new Map<string, FieldLengths>();
    const lengths: FieldLengths = { title: 0, summary: 0, tags: 0, body: 0 };

    for (const f of INDEX_FIELDS) {
      if (configs[f].boost === 0) continue;
      const stats = tokenStats(texts[f]);
      lengths[f] = stats.length;
      totalFieldLengths[f] += stats.length;
      for (const [term, count] of stats.frequencies) {
        let frequencies = termFields.get(term);
        if (!frequencies) {
          frequencies = { title: 0, summary: 0, tags: 0, body: 0 };
          termFields.set(term, frequencies);
        }
        frequencies[f] += count;
      }
    }

    fieldLengths.set(entry.id, lengths);

    // Build each document's postings from one term map. The previous shape
    // allocated four field maps plus a union Set per entry even when a field
    // was disabled (KG nodes disable summary/body). Cold Wiki builds project
    // thousands of KG nodes, so those short-lived containers amplified GC
    // pauses without contributing any searchable state.
    for (const [term, fieldTfs] of termFields) {
      let list = fieldPostings.get(term);
      if (!list) { list = []; fieldPostings.set(term, list); }
      list.push({ docId: entry.id, fieldTfs });
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
    postings: new Map(),
    docLengths: new Map(),
    avgDocLength: 0,
    totalDocs,
    fieldPostings,
    fieldLengths,
    avgFieldLengths,
    docConfigKeys,
  };
}

// ---------------------------------------------------------------------------
// BM25F scoring
// ---------------------------------------------------------------------------

export function searchBM25(
  index: InvertedIndex,
  query: string,
  limit = 50,
  credibilityFactors?: Map<string, number>,
  allowedDocIds?: ReadonlySet<string>,
  candidateBudget?: SearchCandidateBudget,
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.totalDocs === 0) return [];

  const weighted = expandQueryTerms(terms, index);
  const effectiveBudget = candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'wiki', mode: 'adaptive' })
      : undefined);
  // Adaptive callers already supplied the boundary-computed provider budget;
  // never multiply it again for credibility reranking.
  const adaptiveLimit = effectiveBudget?.adaptive
    ? Math.min(effectiveBudget.maxCandidateLimit, effectiveBudget.candidateLimit)
    : undefined;
  const fetchLimit = adaptiveLimit
    ?? ((credibilityFactors && credibilityFactors.size > 0) ? limit * 2 : limit);
  const results = searchBM25F(index, weighted, fetchLimit, allowedDocIds);

  if (credibilityFactors && credibilityFactors.size > 0) {
    for (const r of results) {
      const factor = credibilityFactors.get(r.docId) ?? 1.0;
      r.score *= factor;
    }
    results.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  }

  return results.slice(0, adaptiveLimit === undefined ? limit : Math.min(limit, adaptiveLimit));
}

function searchBM25F(
  index: InvertedIndex,
  weightedTerms: WeightedTerm[],
  limit: number,
  allowedDocIds?: ReadonlySet<string>,
): SearchResult[] {
  const fp = index.fieldPostings;
  const fl = index.fieldLengths;
  const afl = index.avgFieldLengths;
  const dck = index.docConfigKeys;
  const fields: FieldName[] = ['title', 'summary', 'tags', 'body'];

  const scores = new Map<string, number>();
  for (const { term, weight } of weightedTerms) {
    const postings = fp.get(term);
    if (!postings || postings.length === 0) continue;

    const df = postings.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));

    for (const { docId, fieldTfs } of postings) {
      if (allowedDocIds && !allowedDocIds.has(docId)) continue;
      const docFL = fl.get(docId);
      if (!docFL) continue;

      const docConfigs = FIELD_CONFIG_MAP[dck.get(docId) ?? 'default'];

      let tfTilde = 0;
      for (const f of fields) {
        const boost = docConfigs[f].boost;
        const b = docConfigs[f].b;
        if (boost === 0 || fieldTfs[f] === 0) continue;
        if (afl[f] === 0) continue;
        const norm = 1 - b + b * (docFL[f] / afl[f]);
        tfTilde += boost * (fieldTfs[f] / (norm || 1));
      }

      const termScore = weight * idf * ((tfTilde * (BM25_K1 + 1)) / (tfTilde + BM25_K1));
      scores.set(docId, (scores.get(docId) ?? 0) + termScore);
    }
  }

  const ranked: SearchResult[] = [];
  for (const [docId, score] of scores) ranked.push({ docId, score });
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return ranked.slice(0, limit);
}

// ---------------------------------------------------------------------------
// BM25F with coverage penalty
// ---------------------------------------------------------------------------

function searchBM25FWithCoverage(
  index: InvertedIndex,
  weightedTerms: WeightedTerm[],
  limit: number,
  coverageOpts: CoveragePenaltyOptions,
  allowedDocIds?: ReadonlySet<string>,
): SearchResult[] {
  const fp = index.fieldPostings;
  const fl = index.fieldLengths;
  const afl = index.avgFieldLengths;
  const dck = index.docConfigKeys;
  const fields: FieldName[] = ['title', 'summary', 'tags', 'body'];

  const scores = new Map<string, number>();
  const docCoverageHits = new Map<string, Set<string>>();

  for (const { term, weight, coverageKey } of weightedTerms) {
    const postings = fp.get(term);
    if (!postings || postings.length === 0) continue;

    const df = postings.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));

    for (const { docId, fieldTfs } of postings) {
      if (allowedDocIds && !allowedDocIds.has(docId)) continue;
      const docFL = fl.get(docId);
      if (!docFL) continue;

      const docConfigs = FIELD_CONFIG_MAP[dck.get(docId) ?? 'default'];

      let tfTilde = 0;
      for (const f of fields) {
        const boost = docConfigs[f].boost;
        const b = docConfigs[f].b;
        if (boost === 0 || fieldTfs[f] === 0) continue;
        if (afl[f] === 0) continue;
        const norm = 1 - b + b * (docFL[f] / afl[f]);
        tfTilde += boost * (fieldTfs[f] / (norm || 1));
      }

      const termScore = weight * idf * ((tfTilde * (BM25_K1 + 1)) / (tfTilde + BM25_K1));
      scores.set(docId, (scores.get(docId) ?? 0) + termScore);

      if (coverageKey) {
        let hits = docCoverageHits.get(docId);
        if (!hits) { hits = new Set(); docCoverageHits.set(docId, hits); }
        hits.add(coverageKey);
      }
    }
  }

  const totalCoreWeight = coverageOpts.coreTerms.reduce((s, ct) => s + ct.weight, 0);
  const coreKeyWeights = new Map(coverageOpts.coreTerms.map(ct => [ct.key, ct.weight]));

  const ranked: SearchResult[] = [];
  for (const [docId, score] of scores) {
    const hits = docCoverageHits.get(docId);
    let matchedWeight = 0;
    if (hits) {
      for (const key of hits) matchedWeight += coreKeyWeights.get(key) ?? 0;
    }
    ranked.push({ docId, score: applyCoveragePenalty(score, matchedWeight, totalCoreWeight, coverageOpts.baseFactor) });
  }
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return ranked.slice(0, limit);
}

// ---------------------------------------------------------------------------
// QueryPlan: classify tokens and build sub-queries
// ---------------------------------------------------------------------------

const CONTEXT_TOKENS = new Set([
  'frontend', 'backend', 'cli', 'dashboard', 'wiki', 'test', 'tests',
  'server', 'client', 'api', 'ui', 'web', 'mobile', 'desktop',
]);

function isCamelCaseIdentifier(raw: string): boolean {
  return /[a-z][A-Z]/.test(raw) || /[A-Z]{2,}[a-z]/.test(raw);
}

function isCodeIdentifier(raw: string): boolean {
  return /[._$/:@-]/.test(raw) || /\d/.test(raw) && /[a-zA-Z]/.test(raw);
}

export function buildQueryPlan(query: string, index?: InvertedIndex): QueryPlan {
  const rawParts = query.split(/\s+/).filter(Boolean);
  const tokens: QueryTokenClassification[] = [];

  for (const raw of rawParts) {
    const normalized = raw.toLowerCase();
    let role: QueryTermRole;
    let weight: number;

    if (isCamelCaseIdentifier(raw) || isCodeIdentifier(raw)) {
      role = 'anchor';
      weight = 1.4;
    } else if (CONTEXT_TOKENS.has(normalized)) {
      role = 'context';
      weight = 0.6;
    } else if (STOP_WORDS.has(normalized)) {
      continue;
    } else {
      role = 'core';
      weight = 1.0;
    }

    tokens.push({ raw, normalized, role, weight });
  }

  const anchors = tokens.filter(t => t.role === 'anchor');
  const cores = tokens.filter(t => t.role === 'core');
  const contexts = tokens.filter(t => t.role === 'context');

  const groups: QueryPlanGroup[] = [];

  if (anchors.length > 0) {
    const anchorTerms = anchors.flatMap(a => tokenize(a.raw));
    groups.push({
      role: 'anchor',
      weightedTerms: expandQueryTerms(anchorTerms, index).map(wt => ({ ...wt, coverageKey: undefined })),
      rrfWeight: 1.4,
    });
  }

  if (cores.length > 0 || (anchors.length > 0 && contexts.length > 0)) {
    const coreAndContextTerms = [...cores, ...contexts].flatMap(t => tokenize(t.raw));
    if (coreAndContextTerms.length > 0) {
      groups.push({
        role: 'core',
        weightedTerms: expandQueryTerms(coreAndContextTerms, index).map(wt => ({ ...wt, coverageKey: undefined })),
        rrfWeight: 1.0,
      });
    }
  }

  if (anchors.length > 0 && cores.length > 0) {
    const allTerms = [...anchors, ...cores].flatMap(t => tokenize(t.raw));
    groups.push({
      role: 'core',
      weightedTerms: expandQueryTerms(allTerms, index).map(wt => ({ ...wt, coverageKey: undefined })),
      rrfWeight: 0.8,
    });
  }

  if (groups.length === 0) {
    const allTerms = tokens.flatMap(t => tokenize(t.raw));
    groups.push({
      role: 'core',
      weightedTerms: expandQueryTerms(allTerms, index).map(wt => ({ ...wt, coverageKey: undefined })),
      rrfWeight: 1.0,
    });
  }

  const coreCoverageTerms: CoverageTerm[] = [...anchors, ...cores].map(t => ({
    key: t.normalized,
    terms: tokenize(t.raw),
    weight: t.weight,
  }));

  return { rawQuery: query, tokens, groups, coreCoverageTerms };
}

// ---------------------------------------------------------------------------
// Planned search: QueryPlan + Coverage + multi-signal RRF
// ---------------------------------------------------------------------------

export function searchBM25Planned(
  index: InvertedIndex,
  query: string,
  limit = 50,
  credibilityFactors?: Map<string, number>,
  allowedDocIds?: ReadonlySet<string>,
  candidateBudget?: SearchCandidateBudget,
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.totalDocs === 0) return [];

  const plan = buildQueryPlan(query, index);
  const effectiveBudget = candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'planned', mode: 'adaptive' })
      : undefined);
  // `candidateBudget` is computed at the request boundary. Legacy callers keep
  // the old planned-search overfetch until adaptive rollout is enabled.
  const internalLimit = effectiveBudget?.adaptive
    ? Math.min(effectiveBudget.maxCandidateLimit, effectiveBudget.candidateLimit)
    : Math.min(500, Math.max(limit * 3, 60));
  const coverageOpts: CoveragePenaltyOptions = {
    coreTerms: plan.coreCoverageTerms,
    baseFactor: 0.65,
  };

  const taggedGroups = plan.groups.map(g => {
    const tagged = g.weightedTerms.map(wt => {
      const covTerm = plan.coreCoverageTerms.find(ct => ct.terms.includes(wt.term));
      return { ...wt, coverageKey: covTerm?.key };
    });
    return { ...g, weightedTerms: tagged };
  });

  const groupResults = taggedGroups.map(g =>
    searchBM25FWithCoverage(
      index,
      g.weightedTerms,
      internalLimit,
      coverageOpts,
      allowedDocIds,
    ),
  );

  // Hybrid group fusion: 0.3 * rrfNorm + 0.7 * bm25Norm
  const k = 10;
  const rrfScores = new Map<string, number>();
  const bm25Scores = new Map<string, number>();
  for (let gi = 0; gi < groupResults.length; gi++) {
    const w = taggedGroups[gi].rrfWeight;
    for (let i = 0; i < groupResults[gi].length; i++) {
      const r = groupResults[gi][i];
      rrfScores.set(r.docId, (rrfScores.get(r.docId) ?? 0) + w / (k + i + 1));
      const cur = bm25Scores.get(r.docId) ?? 0;
      if (r.score > cur) bm25Scores.set(r.docId, r.score);
    }
  }

  let maxRrf = 1e-9;
  for (const val of rrfScores.values()) {
    if (val > maxRrf) maxRrf = val;
  }

  let maxBm25 = 1e-9;
  for (const val of bm25Scores.values()) {
    if (val > maxBm25) maxBm25 = val;
  }

  let ranked: SearchResult[] = [];
  for (const [docId] of rrfScores) {
    const rn = (rrfScores.get(docId) ?? 0) / maxRrf;
    const bn = (bm25Scores.get(docId) ?? 0) / maxBm25;
    ranked.push({ docId, score: 0.3 * rn + 0.7 * bn });
  }
  ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));

  if (credibilityFactors && credibilityFactors.size > 0) {
    for (const r of ranked) {
      const factor = credibilityFactors.get(r.docId) ?? 1.0;
      r.score *= factor;
    }
    ranked.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  }

  return ranked.slice(0, effectiveBudget?.adaptive
    ? Math.min(limit, effectiveBudget.candidateLimit)
    : limit);
}

// ---------------------------------------------------------------------------
// Phrase / proximity rerank (Phase 4)
// ---------------------------------------------------------------------------

export interface ProximityRerankOptions {
  windowSize?: number;
  maxBoost?: number;
}

export function rerankByPhraseProximity(
  results: Array<{ entry: WikiEntry; score: number }>,
  query: string,
  options?: ProximityRerankOptions,
): Array<{ entry: WikiEntry; score: number }> {
  const windowSize = options?.windowSize ?? 8;
  const maxBoost = options?.maxBoost ?? 0.20;

  const qTerms = tokenize(query);
  if (qTerms.length < 2) return results;

  const qUnique = [...new Set(qTerms)];
  const qPhrase = qUnique.join(' ');

  const fieldWeights = [
    { getText: (e: WikiEntry) => e.title, weight: 0.5 },
    { getText: (e: WikiEntry) => e.summary, weight: 0.3 },
    { getText: (e: WikiEntry) => e.body, weight: 0.2 },
  ];

  for (const r of results) {
    let boost = 0;
    for (const { getText, weight } of fieldWeights) {
      const text = getText(r.entry);
      if (!text) continue;
      const fieldTokens = tokenize(text);
      if (fieldTokens.length === 0) continue;

      const phraseMatch = fieldTokens.join(' ').includes(qPhrase) ? 1 : 0;

      let proximity = 0;
      if (qUnique.every(qt => fieldTokens.includes(qt))) {
        const positions = qUnique.map(qt => {
          const idxs: number[] = [];
          for (let i = 0; i < fieldTokens.length; i++) {
            if (fieldTokens[i] === qt) idxs.push(i);
          }
          return idxs;
        });

        let minSpan = Infinity;
        const cursors = new Array(positions.length).fill(0);
        const advance = () => {
          let minIdx = 0;
          for (let i = 1; i < cursors.length; i++) {
            if (positions[i][cursors[i]] < positions[minIdx][cursors[minIdx]]) minIdx = i;
          }
          cursors[minIdx]++;
          return cursors[minIdx] < positions[minIdx].length;
        };

        let iterLimit = fieldTokens.length * 2;
        while (iterLimit-- > 0) {
          if (cursors.some((c, i) => c >= positions[i].length)) break;
          const vals = cursors.map((c, i) => positions[i][c]);
          const span = Math.max(...vals) - Math.min(...vals) + 1;
          if (span < minSpan) minSpan = span;
          if (!advance()) break;
        }

        if (minSpan < Infinity) {
          proximity = Math.max(0, (windowSize + 1 - minSpan) / windowSize);
        }
      }

      boost += weight * Math.min(maxBoost, 0.12 * phraseMatch + 0.08 * proximity);
    }
    r.score *= (1 + Math.min(maxBoost, boost));
  }

  results.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return results;
}
