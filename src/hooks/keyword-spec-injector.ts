/**
 * Keyword Spec Injector — UserPromptSubmit hook
 *
 * Scans user prompt for keywords, matches against <spec-entry> keyword attributes,
 * injects matching entries as additionalContext. Session dedup prevents re-injection.
 * Also injects domain term context (compact always + expanded on keyword match).
 */

import { join } from 'node:path';
import { buildKeywordIndex, lookupKeywords, type IndexedEntry } from '../tools/spec-keyword-index.js';
import { readSpecBridge, markInjected, filterUnjected } from './spec-bridge.js';
import { logInjectionEvent } from './spec-analytics.js';
import { truncateMaestroContext, wrapMaestroContext, type ContextSection } from './context-format.js';
import { loadGlossary, type DomainTerm } from '../tools/domain-loader.js';
import { matchDomainTerms, collectRewriteHints } from '../tools/domain-matcher.js';
import { searchWiki, type WikiSearchHit } from './wiki-search-bridge.js';
import { buildKgContextSections } from './kg-context-injector.js';

// ============================================================================
// Types
// ============================================================================

export interface KeywordInjectionResult {
  inject: boolean;
  content?: string;
  matchedKeywords?: string[];
  matchedEntries?: number;
}

// ============================================================================
// Config
// ============================================================================

const MIN_KEYWORD_LENGTH = 3;
const MIN_CJK_KEYWORD_LENGTH = 2;

/** Common English words to skip when tokenizing prompt */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may',
  'new', 'now', 'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say',
  'she', 'too', 'use', 'this', 'that', 'with', 'have', 'from', 'they',
  'been', 'said', 'each', 'make', 'like', 'just', 'over', 'such', 'take',
  'than', 'them', 'very', 'when', 'what', 'some', 'time', 'will', 'into',
  'look', 'only', 'come', 'also', 'back', 'after', 'work', 'first', 'well',
  'then', 'year', 'your', 'them', 'would', 'there', 'their', 'which',
  'about', 'could', 'other', 'these', 'think', 'should', 'please',
  // code-related common words to skip
  'file', 'code', 'function', 'class', 'import', 'export', 'const', 'return',
  'true', 'false', 'null', 'undefined', 'string', 'number', 'type', 'interface',
]);

/** Common Chinese functional words to skip */
const CJK_STOP_WORDS = new Set([
  '可以', '这个', '那个', '什么', '怎么', '如何', '为什么',
  '已经', '还是', '或者', '但是', '因为', '所以', '如果',
  '虽然', '然后', '就是', '不是', '没有', '可能', '应该',
  '需要', '使用', '进行', '通过', '以及', '一个', '我们',
  '他们', '这些', '那些', '所有', '其他', '目前', '现在',
  '之后', '之前', '关于', '对于', '还有', '为了', '只是',
  '这样', '那样', '一下', '一些', '看看', '帮我', '请问',
]);

/** Max entries to inject per prompt to avoid context bloat */
const MAX_ENTRIES_PER_INJECTION = 5;
const MAX_PROMPT_CONTEXT_CHARS = 4096;

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate whether to inject keyword-matched spec entries for a user prompt.
 *
 * @param prompt      The user's prompt text
 * @param projectPath Working directory for spec file resolution
 * @param sessionId   Session ID for dedup bridge
 */
export async function evaluateKeywordInjection(
  prompt: string,
  projectPath: string,
  sessionId: string,
): Promise<KeywordInjectionResult> {
  const sections: ContextSection[] = [];

  const workflowRoot = join(projectPath, '.workflow');

  // ── Domain context (always evaluated) ──────────────────────────────
  const domainSections = buildDomainSections(prompt, projectPath);
  sections.push(...domainSections);

  // ── Spec keyword matching ──────────────────────────────────────────
  const promptKeywords = tokenizePrompt(prompt);
  let toInject: IndexedEntry[] = [];
  let overflowEntries: IndexedEntry[] = [];
  let matchedKws: string[] = [];

  if (promptKeywords.length > 0) {
    const index = buildKeywordIndex(projectPath);
    if (index.size > 0) {
      const matchedAll = lookupKeywords(index, promptKeywords);
      if (matchedAll.length > 0) {
        const unjected = filterUnjected(sessionId, matchedAll);
        if (unjected.length > 0) {
          toInject = unjected.slice(0, MAX_ENTRIES_PER_INJECTION);
          sections.push(buildKeywordSection(toInject));
          
          const overflow = unjected.slice(MAX_ENTRIES_PER_INJECTION, MAX_ENTRIES_PER_INJECTION + 15);
          if (overflow.length > 0) {
            sections.push(buildCompactKeywordSection(overflow));
            overflowEntries = overflow;
          }
          
          matchedKws = promptKeywords.filter(kw => index.has(kw));
        }
      }
    }
  }

  // ── Wiki BM25 search (best-effort) ──────────────────────────────
  let wikiSource: 'daemon' | 'indexer' | 'keyword' | 'none' = 'none';
  if (toInject.length > 0) wikiSource = 'keyword';
  try {
    const { hits, source } = await searchWiki(workflowRoot, prompt, { limit: 3 });
    if (source !== 'none') wikiSource = source;
    if (hits.length > 0) {
      const wikiEntries = hits.map(h => ({ id: h.id, keywords: [] as string[] }));
      const unjected = filterUnjected(sessionId, wikiEntries);
      const unjectedHits = hits.filter(h => unjected.some(u => u.id === h.id)).slice(0, 3);
      if (unjectedHits.length > 0) {
        sections.push(buildWikiSection(unjectedHits));
        markInjected(sessionId, [], unjectedHits.map(h => h.id));
      }
    }
  } catch { /* best-effort */ }

  // ── KG code context (best-effort, composed into the shared budget) ──
  try {
    sections.push(...await buildKgContextSections(prompt, projectPath));
  } catch { /* best-effort */ }

  // ── Assemble result ────────────────────────────────────────────────
  const liveSections = sections.filter(s => s.lines.length > 0);
  if (liveSections.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'keyword-spec-injector',
      promptSnippet: prompt.slice(0, 300),
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'no-matches',
      totalPromptKeywords: promptKeywords.length,
    });
    return { inject: false };
  }

  const usedChars = liveSections.reduce(
    (sum, s) => sum + s.lines.reduce((acc, l) => acc + l.length, 0),
    0,
  );
  let content = wrapMaestroContext(liveSections, {
    used: Math.min(usedChars, MAX_PROMPT_CONTEXT_CHARS),
    max: MAX_PROMPT_CONTEXT_CHARS,
  });
  content = truncateMaestroContext(content, MAX_PROMPT_CONTEXT_CHARS);

  let allInjectedEntries = [...toInject, ...overflowEntries];
  if (allInjectedEntries.length > 0) {
    const injectedKeywords = [...new Set(allInjectedEntries.flatMap(e => e.keywords))];
    const injectedIds = allInjectedEntries.map(e => e.id);
    markInjected(sessionId, injectedKeywords, injectedIds);
  }

  logInjectionEvent(projectPath, {
    source: 'keyword-spec-injector',
    promptSnippet: prompt.slice(0, 300),
    categories: [],
    specCount: toInject.length, // Only count full entries for telemetry
    contentLength: content.length,
    inject: true,
    matchedKeywords: matchedKws,
    matchedEntries: toInject.length,
    totalPromptKeywords: promptKeywords.length,
    domainTermsMatched: domainSections.length > 0 ? domainSections.reduce((n, s) => n + s.lines.length, 0) : 0,
    searchSource: wikiSource !== 'none' ? wikiSource : (matchedKws.length > 0 ? 'keyword' : undefined),
  });

  return {
    inject: true,
    content,
    matchedKeywords: matchedKws,
    matchedEntries: toInject.length,
  };
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Tokenize prompt into candidate keywords for index lookup.
 * Handles both English (space-split) and CJK (n-gram extraction).
 */
function tokenizePrompt(prompt: string): string[] {
  const text = prompt.toLowerCase();

  // English tokens: split by non-alphanumeric, filter by length and stop words
  const englishWords = text
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));

  // CJK tokens: extract n-grams (2-4 chars) from contiguous CJK sequences
  const cjkTokens = extractCjkTokens(prompt)
    .filter(w => !CJK_STOP_WORDS.has(w));

  return [...new Set([...englishWords, ...cjkTokens])];
}

/**
 * Extract keyword tokens from CJK text using n-gram segmentation.
 * Generates 2-4 character n-grams from contiguous CJK sequences.
 */
function extractCjkTokens(text: string): string[] {
  const tokens: string[] = [];
  // Match contiguous CJK character runs (min 2 chars)
  const cjkSeqs = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) ?? [];

  for (const seq of cjkSeqs) {
    // Full sequence if reasonable length (common phrase)
    if (seq.length >= MIN_CJK_KEYWORD_LENGTH && seq.length <= 6) {
      tokens.push(seq);
    }
    // Generate 2-gram, 3-gram, 4-gram
    for (let n = 2; n <= Math.min(4, seq.length); n++) {
      for (let i = 0; i <= seq.length - n; i++) {
        tokens.push(seq.substring(i, i + n));
      }
    }
  }

  return tokens;
}

/**
 * Build a keyword-match section for the unified <maestro-context> block.
 *
 * Section label: `keyword[kw1,kw2]` listing the distinct keywords matched.
 * Each line is compact: `<category> · <keywords> · <title>: <oneline body>`.
 */
function buildKeywordSection(entries: IndexedEntry[]): ContextSection {
  const allKeywords = [...new Set(entries.flatMap(e => e.keywords))];
  const label = `keyword[${allKeywords.join(',')}]`;

  const lines = entries.map(e => {
    const body = e.content
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    const kws = e.keywords.join(',');
    const titlePrefix = e.title ? `${e.title}: ` : '';
    const badge = e.confidence === 'contested' ? '[CONTESTED] '
      : e.confidence === 'low' ? '[LOW CONFIDENCE] '
      : '';
    return `${badge}${e.category} · ${kws} · ${titlePrefix}${body}`;
  });

  return { label, lines };
}

/**
 * Build a concise keyword-match overflow section for the unified <maestro-context> block.
 * Each line only includes the category, keywords and title.
 */
function buildCompactKeywordSection(entries: IndexedEntry[]): ContextSection {
  const allKeywords = [...new Set(entries.flatMap(e => e.keywords))];
  const label = `keyword-overflow[${allKeywords.join(',')}]`;

  const lines = entries.map(e => {
    const kws = e.keywords.join(',');
    const title = e.title ? e.title : e.id;
    return `↳ ${e.category} · ${kws} · ${title}`;
  });

  return { label, lines };
}

/**
 * Build a wiki BM25 search-match section for the unified <maestro-context> block.
 * Each line is compact: `<type> · <title>: <oneline summary>`.
 */
function buildWikiSection(hits: WikiSearchHit[]): ContextSection {
  const lines = hits.map(h => {
    const summary = h.summary.replace(/\s+/g, ' ').trim();
    return `${h.type} · ${h.title}: ${summary}`;
  });
  return { label: 'wiki[matched]', lines };
}

// ============================================================================
// KG Symbol Lookup
// ============================================================================

// ============================================================================
// Domain Context Builder
// ============================================================================

const MAX_COMPACT_CHARS = 800;

function buildDomainSections(prompt: string, projectPath: string): ContextSection[] {
  const sections: ContextSection[] = [];

  try {
    const { exists, glossary, activeTerms, isEmpty } = loadGlossary(projectPath);
    if (!exists || isEmpty || !glossary) return sections;

    // Always: compact summary (core tier only, size-limited)
    const compactSection = buildDomainCompactSection(activeTerms);
    if (compactSection) sections.push(compactSection);

    // Keyword-matched: expanded definitions
    const allTerms = glossary.terms;
    const { directMatches, propagatedIds } = matchDomainTerms(prompt, allTerms);

    if (directMatches.length > 0) {
      const expandedSection = buildDomainExpandedSection(directMatches, propagatedIds, allTerms);
      if (expandedSection) sections.push(expandedSection);

      // Rewrite hints
      const hints = collectRewriteHints(
        directMatches.map(m => m.termId),
        allTerms,
      );
      if (Object.keys(hints).length > 0) {
        const hintLines = Object.entries(hints).map(([from, to]) => `"${from}" → ${to}`);
        sections.push({ label: 'domain-rewrite', lines: hintLines });
      }
    }

    // Resolve spec-entry domain="" attributes for matched domain terms
    // This is handled at injection assembly time — entries with domain=""
    // attributes get domain context auto-appended via the expanded section above.
  } catch { /* domain injection is best-effort */ }

  return sections;
}

function buildDomainCompactSection(activeTerms: DomainTerm[]): ContextSection | null {
  const coreTerms = activeTerms.filter(t => (t.tier ?? 'core') === 'core');
  if (coreTerms.length === 0) return null;

  let summary = '';
  const parts: string[] = [];
  for (const t of coreTerms) {
    const entry = `${t.canonical}=${t.definition}`;
    if (summary.length + entry.length + 3 > MAX_COMPACT_CHARS) break;
    summary += (summary ? ' | ' : '') + entry;
    parts.push(entry);
  }
  if (parts.length === 0) return null;

  return { label: 'domain-compact', lines: [summary] };
}

function buildDomainExpandedSection(
  directMatches: Array<{ termId: string; canonical: string; definition: string; matchedBy: string; matchedToken: string }>,
  propagatedIds: string[],
  allTerms: DomainTerm[],
): ContextSection | null {
  const injected = new Set<string>();
  const lines: string[] = [];

  // Direct matches — full expansion
  for (const match of directMatches) {
    if (injected.has(match.termId)) continue;
    injected.add(match.termId);
    const term = allTerms.find(t => t.id === match.termId);
    if (!term) continue;

    const deprecatedTag = term.status === 'deprecated' ? ' [DEPRECATED]' : '';
    let line = `${term.canonical}${deprecatedTag}: ${term.definition}`;
    if (term.aliases.length > 0) line += ` | aliases: ${term.aliases.join(', ')}`;
    if (term.relationships.length > 0) {
      const relNames = term.relationships.map(rid => {
        const rel = allTerms.find(t => t.id === rid);
        return rel ? rel.canonical : rid;
      });
      line += ` | → ${relNames.join(', ')}`;
    }
    if (term.deprecated_info?.successor_id) {
      const successor = allTerms.find(t => t.id === term.deprecated_info!.successor_id);
      line += ` | use instead: ${successor?.canonical ?? term.deprecated_info.successor_id}`;
    }
    lines.push(line);
  }

  // Propagated — compact one-liners
  for (const relId of propagatedIds) {
    if (injected.has(relId)) continue;
    injected.add(relId);
    const term = allTerms.find(t => t.id === relId);
    if (!term || (term.status ?? 'active') === 'deprecated') continue;
    lines.push(`↳ ${term.canonical}: ${term.definition}`);
  }

  if (lines.length === 0) return null;
  const matchedNames = directMatches.map(m => m.canonical.toLowerCase());
  return { label: `domain[${matchedNames.join(',')}]`, lines };
}

/**
 * Resolve domain context for a spec-entry's domain="" attribute.
 * Returns a one-line definition or null if term not found.
 */
export function resolveDomainContext(domainId: string, projectPath: string): string | null {
  try {
    const { glossary } = loadGlossary(projectPath);
    if (!glossary) return null;
    const term = glossary.terms.find(t => t.id === domainId);
    return term ? `${term.canonical}: ${term.definition}` : null;
  } catch { return null; }
}
