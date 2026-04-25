/**
 * Spec entry parser — shared between specs routes and WikiIndexer.
 *
 * Extracts SpecEntry objects from markdown body text. Supports both
 * `<spec-entry>` closed-tag format and legacy heading-based format.
 */

import { basename, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  file: string;
  timestamp: string;
  category: string;
  keywords: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTRY_TYPES = [
  'coding', 'arch', 'quality', 'debug', 'test', 'review', 'learning',
  'bug', 'pattern', 'decision', 'rule', 'validation',
] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

const FILE_TYPE_MAP: Record<string, EntryType> = {
  learnings: 'learning',
  'coding-conventions': 'coding',
  'architecture-constraints': 'arch',
  'quality-rules': 'quality',
  'debug-notes': 'debug',
  'test-conventions': 'test',
  'review-standards': 'review',
};

export const FILE_CATEGORY_MAP: Record<string, string> = {
  learnings: 'learning',
  'coding-conventions': 'coding',
  'architecture-constraints': 'arch',
  'quality-rules': 'quality',
  'debug-notes': 'debug',
  'test-conventions': 'test',
  'review-standards': 'review',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Heading regex: matches ## or ### at start of line. */
export const HEADING_RE = /^(#{2,3})\s+(.+)$/;

const SPEC_ENTRY_TAG_RE = /<spec-entry\s+([^>]+)>([\s\S]*?)<\/spec-entry>/g;
const TAG_ATTR_RE = /([\w-]+)="([^"]*)"/g;

/** Detect entry type from heading text or fall back to file-based default. */
export function detectEntryType(heading: string, fileName: string): string {
  const lower = heading.toLowerCase();
  for (const t of ENTRY_TYPES) {
    if (lower.includes(`[${t}]`)) return t;
  }
  for (const t of ENTRY_TYPES) {
    if (new RegExp(`\\b${t}\\s*:`).test(lower)) return t;
  }
  const stem = basename(fileName, extname(fileName));
  return FILE_TYPE_MAP[stem] ?? 'general';
}

/** Strip [type], [date], and legacy "type:" prefix from heading to get clean title. */
export function extractCleanTitle(heading: string): string {
  return heading
    .replace(
      /\[(coding|arch|quality|debug|test|review|learning|bug|pattern|decision|rule|validation)\]\s*/gi,
      '',
    )
    .replace(/\[\d{4}-\d{2}-\d{2}\]\s*/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]*/g, '')
    .replace(
      /^(coding|arch|quality|debug|test|review|learning|bug|pattern|decision|rule|validation)\s*:\s*/i,
      '',
    )
    .trim();
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse markdown body into SpecEntry objects.
 * First extracts <spec-entry> closed-tag blocks, then parses remaining text
 * with legacy heading-based parser.
 */
export function parseSpecEntries(
  body: string,
  fileName: string,
  frontmatter?: Record<string, unknown>,
): SpecEntry[] {
  const stem = basename(fileName, extname(fileName));
  const entries: SpecEntry[] = [];
  let entryIndex = 0;

  // Pass 1: Extract <spec-entry> closed-tag blocks
  const consumedRanges: Array<{ start: number; end: number }> = [];
  let tagMatch: RegExpExecArray | null;
  SPEC_ENTRY_TAG_RE.lastIndex = 0;

  while ((tagMatch = SPEC_ENTRY_TAG_RE.exec(body)) !== null) {
    const attrStr = tagMatch[1];
    const innerContent = tagMatch[2].trim();
    consumedRanges.push({ start: tagMatch.index, end: tagMatch.index + tagMatch[0].length });

    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    TAG_ATTR_RE.lastIndex = 0;
    while ((attrMatch = TAG_ATTR_RE.exec(attrStr)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const titleMatch = innerContent.match(/^###\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : innerContent.split('\n')[0].trim();
    const type = attrs.category ?? detectEntryType(title, fileName);
    const id = `${stem}-${String(++entryIndex).padStart(3, '0')}`;
    const kws = attrs.keywords ? attrs.keywords.split(',').map((k) => k.trim()) : [];

    entries.push({
      id,
      type,
      title,
      content: innerContent,
      file: fileName,
      timestamp: attrs.date ?? '',
      category:
        attrs.category ??
        (typeof frontmatter?.category === 'string'
          ? frontmatter.category
          : (FILE_CATEGORY_MAP[stem] ?? 'general')),
      keywords: kws,
    });
  }

  // Pass 2: Parse remaining text with legacy heading-based parser
  let remaining = body;
  for (const range of consumedRanges.reverse()) {
    remaining = remaining.substring(0, range.start) + remaining.substring(range.end);
  }

  const lines = remaining.split('\n');
  const sections: { heading: string; level: number; bodyLines: string[] }[] = [];
  let current: { heading: string; level: number; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);

  for (const sec of sections) {
    const content = sec.bodyLines.join('\n').trim();
    if (!content) continue;

    const type = detectEntryType(sec.heading, fileName);
    const id = `${stem}-${String(++entryIndex).padStart(3, '0')}`;
    const dateMatch =
      sec.heading.match(/\[(\d{4}-\d{2}-\d{2})\]/) ?? sec.heading.match(/(\d{4}-\d{2}-\d{2})/);
    const timestamp = dateMatch ? dateMatch[1] : '';
    const title = extractCleanTitle(sec.heading) || sec.heading;
    const category =
      typeof frontmatter?.category === 'string'
        ? frontmatter.category
        : (FILE_CATEGORY_MAP[stem] ?? 'general');
    const keywords = Array.isArray(frontmatter?.keywords)
      ? frontmatter.keywords.map(String)
      : [];
    entries.push({ id, type, title, content, file: fileName, timestamp, category, keywords });
  }

  return entries;
}
