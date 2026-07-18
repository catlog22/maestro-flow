/**
 * Spec Keyword Index
 *
 * Builds an inverted index from keyword → spec entries.
 * Scans all `.workflow/specs/*.md` files, parses <spec-entry> tags,
 * and indexes by keyword for fast lookup.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpecEntries, type SpecEntryParsed } from './spec-entry-parser.js';
import { CATEGORY_MAP } from './spec-loader.js';
import { stripFrontmatter } from '../utils/frontmatter.js';

// ============================================================================
// Types
// ============================================================================

export interface IndexedEntry {
  file: string;
  category: string;
  keywords: string[];
  content: string;
  title: string;
  id: string;
  confidence?: string;
  conflictMarker?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build a keyword → entries inverted index from all spec files.
 * Each keyword maps to an array of matching entries.
 */
export function buildKeywordIndex(projectPath: string): Map<string, IndexedEntry[]> {
  const index = new Map<string, IndexedEntry[]>();
  const specsDir = join(projectPath, '.workflow', 'specs');

  if (!existsSync(specsDir)) return index;

  let files: string[];
  try {
    files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
  } catch {
    return index;
  }

  for (const file of files) {
    const filePath = join(specsDir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const body = stripFrontmatter(raw);
    const { entries } = parseSpecEntries(body);
    const fileCategory = CATEGORY_MAP[file] ?? 'learning';

    for (const entry of entries) {
      // Deprecated (superseded) entries are never injected into agent context —
      // align with spec-loader's formatFileContent filtering.
      if (entry.status === 'deprecated') continue;

      const indexed: IndexedEntry = {
        file,
        category: entry.category || fileCategory,
        keywords: entry.keywords,
        content: entry.content,
        title: entry.title,
        id: `${file}:${entry.lineStart}`,
        confidence: entry.confidence,
        conflictMarker: entry.conflictMarker,
      };

      for (const kw of entry.keywords) {
        addToIndex(index, kw, indexed);

        // Index CJK sub-tokens so partial matches work
        // e.g. keyword "设计系统" also indexes "设计" and "系统"
        if (/[\u4e00-\u9fff]/.test(kw) && kw.length > 2) {
          for (let n = 2; n <= Math.min(4, kw.length); n++) {
            for (let i = 0; i <= kw.length - n; i++) {
              const sub = kw.substring(i, i + n);
              if (sub !== kw) addToIndex(index, sub, indexed);
            }
          }
        }
      }
    }
  }

  return index;
}

function addToIndex(index: Map<string, IndexedEntry[]>, key: string, entry: IndexedEntry): void {
  const k = key.toLowerCase();
  const list = index.get(k);
  if (list) {
    // Avoid duplicate entries under the same key
    if (!list.some(e => e.id === entry.id)) list.push(entry);
  } else {
    index.set(k, [entry]);
  }
}

/**
 * Look up entries matching a keyword.
 */
export function lookupKeyword(index: Map<string, IndexedEntry[]>, keyword: string): IndexedEntry[] {
  return index.get(keyword.toLowerCase()) ?? [];
}

/**
 * Look up entries matching any of the given keywords.
 * Returns deduplicated entries (by id).
 */
export function lookupKeywords(index: Map<string, IndexedEntry[]>, keywords: string[]): IndexedEntry[] {
  const scored = new Map<string, { entry: IndexedEntry; score: number; matched: Set<string> }>();

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const entries = index.get(k) ?? [];

    for (const entry of entries) {
      if (!scored.has(entry.id)) {
        scored.set(entry.id, { entry, score: 0, matched: new Set<string>() });
      }

      const state = scored.get(entry.id)!;
      if (!state.matched.has(k)) {
        state.matched.add(k);

        let kwWeight = 10;

        // Exact match in defined keywords gets higher weight
        if (entry.keywords.some(ek => ek.toLowerCase() === k)) {
          kwWeight += 10;
        } else {
          // It's a CJK sub-token match, base it on length
          kwWeight += k.length * 2;
        }

        // Title match gets extra weight
        if (entry.title && entry.title.toLowerCase().includes(k)) {
          kwWeight += 15;
        }

        // Content match gets some weight
        if (entry.content && entry.content.toLowerCase().includes(k)) {
          kwWeight += 5;
        }

        state.score += kwWeight;
      }
    }
  }

  // Adjust by confidence
  for (const state of scored.values()) {
    const conf = state.entry.confidence;
    if (conf === 'high') state.score *= 1.5;
    else if (conf === 'low') state.score *= 0.8;
    else if (conf === 'contested') state.score *= 0.5;
  }

  // Sort by score descending
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .map(s => s.entry);
}

// ============================================================================
// Internal
// ============================================================================

// stripFrontmatter imported from utils/frontmatter.ts
