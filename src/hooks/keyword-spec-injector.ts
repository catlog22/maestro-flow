/**
 * Keyword Spec Injector — UserPromptSubmit hook
 *
 * Scans user prompt for keywords, matches against <spec-entry> keyword attributes,
 * injects matching entries as additionalContext. Session dedup prevents re-injection.
 */

import { buildKeywordIndex, lookupKeywords, type IndexedEntry } from '../tools/spec-keyword-index.js';
import { readSpecBridge, markInjected, filterUnjected } from './spec-bridge.js';
import { logInjectionEvent } from './spec-analytics.js';
import { wrapMaestroContext, type ContextSection } from './context-format.js';

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
  // 1. Tokenize prompt into candidate keywords
  const promptKeywords = tokenizePrompt(prompt);
  if (promptKeywords.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'keyword-spec-injector',
      promptSnippet: prompt.slice(0, 300),
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'no-prompt-keywords',
      totalPromptKeywords: 0,
    });
    return { inject: false };
  }

  // 2. Build keyword index from spec files
  const index = buildKeywordIndex(projectPath);
  if (index.size === 0) {
    logInjectionEvent(projectPath, {
      source: 'keyword-spec-injector',
      promptSnippet: prompt.slice(0, 300),
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'empty-keyword-index',
      totalPromptKeywords: promptKeywords.length,
    });
    return { inject: false };
  }

  // 3. Look up matching entries
  const matchedAll = lookupKeywords(index, promptKeywords);
  if (matchedAll.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'keyword-spec-injector',
      promptSnippet: prompt.slice(0, 300),
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'no-keyword-match',
      totalPromptKeywords: promptKeywords.length,
    });
    return { inject: false };
  }

  // 4. Filter out already-injected entries (session dedup)
  const unjected = filterUnjected(sessionId, matchedAll);
  if (unjected.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'keyword-spec-injector',
      promptSnippet: prompt.slice(0, 300),
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'all-deduped',
      totalPromptKeywords: promptKeywords.length,
      dedupFilteredCount: matchedAll.length,
    });
    return { inject: false };
  }

  // 5. Limit to avoid context bloat
  const toInject = unjected.slice(0, MAX_ENTRIES_PER_INJECTION);

  // 6. Build injection sections — keyword matches + (optional) KG symbols,
  //    merged into ONE <maestro-context> block.
  const sections: ContextSection[] = [buildKeywordSection(toInject)];

  // 6b. KG symbol lookup — append code graph context if available
  try {
    const symbolSection = await evaluateKgSymbolLookup(prompt, projectPath);
    if (symbolSection) {
      sections.push(symbolSection);
    }
  } catch {
    // KG lookup is best-effort — silently skip on any failure
  }

  // Per-injector budget reporting (format-only; no cross-injector pooling yet).
  const usedChars = sections.reduce(
    (sum, s) => sum + s.lines.reduce((acc, l) => acc + l.length, 0),
    0,
  );
  const content = wrapMaestroContext(sections, { used: usedChars, max: usedChars });

  // 7. Mark as injected
  const injectedKeywords = [...new Set(toInject.flatMap(e => e.keywords))];
  const injectedIds = toInject.map(e => e.id);
  markInjected(sessionId, injectedKeywords, injectedIds);

  // 8. Determine which prompt keywords actually matched
  const matchedKws = promptKeywords.filter(kw => index.has(kw));

  logInjectionEvent(projectPath, {
    source: 'keyword-spec-injector',
    promptSnippet: prompt.slice(0, 300),
    categories: [],
    specCount: toInject.length,
    contentLength: content.length,
    inject: true,
    matchedKeywords: matchedKws,
    matchedEntryIds: injectedIds,
    matchedEntries: toInject.length,
    totalPromptKeywords: promptKeywords.length,
    dedupFilteredCount: matchedAll.length - unjected.length,
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
      .replace(/^#{1,6}\s+.*$/gm, '') // strip markdown headings (title is added separately)
      .replace(/\s+/g, ' ')
      .trim();
    const kws = e.keywords.join(',');
    const titlePrefix = e.title ? `${e.title}: ` : '';
    return `${e.category} · ${kws} · ${titlePrefix}${body}`;
  });

  return { label, lines };
}

// ============================================================================
// KG Symbol Lookup
// ============================================================================

const KG_SYMBOL_PATTERN = /\b[a-z]+[A-Z][a-zA-Z0-9]*\b|\b[a-z]+_[a-z0-9_]+\b/g;
const KG_MAX_SYMBOLS = 3;
const KG_MAX_RESULTS_PER_SYMBOL = 2;
const KG_MAX_CONTENT_LENGTH = 512;

/**
 * Extract camelCase/snake_case symbols from prompt and look up in KG.
 * Returns a `kg-symbols` ContextSection or null if nothing found.
 * Entire function is best-effort — returns null on any failure.
 */
async function evaluateKgSymbolLookup(prompt: string, projectPath: string): Promise<ContextSection | null> {
  const matches = prompt.match(KG_SYMBOL_PATTERN);
  if (!matches || matches.length === 0) return null;

  const symbols = [...new Set(matches)].slice(0, KG_MAX_SYMBOLS);

  try {
    const { isCodeGraphAvailable, CodeGraphAdapter } = require('../graph/codegraph-adapter.js');
    if (!isCodeGraphAvailable()) return null;

    const adapter = new CodeGraphAdapter(projectPath);
    try {
      if (!adapter.isInitialized()) return null;

      const lines: string[] = [];
      let totalLen = 0;

      for (const sym of symbols) {
        if (totalLen >= KG_MAX_CONTENT_LENGTH) break;

        const results = await adapter.searchNodes(sym, { limit: KG_MAX_RESULTS_PER_SYMBOL });
        for (const r of results) {
          const node = r.node ?? r;
          const line = `[${node.kind}] ${node.name}` +
            (node.filePath ? ` (${node.filePath}:${node.startLine})` : '') +
            (node.signature ? ` — ${node.signature}` : '');

          if (totalLen + line.length > KG_MAX_CONTENT_LENGTH) break;
          lines.push(line);
          totalLen += line.length;
        }
      }

      if (lines.length === 0) return null;
      return { label: 'kg-symbols', lines };
    } finally {
      try { adapter.close(); } catch { /* best-effort */ }
    }
  } catch {
    return null;
  }
}
