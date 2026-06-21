/**
 * Spec Entry Parser
 *
 * Parses `<spec-entry>` closed-tag blocks from spec markdown files.
 * Supports dual-format: new `<spec-entry>` tags + legacy heading-based entries.
 */

// ============================================================================
// Types
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'contested';

export const VALID_CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['high', 'medium', 'low', 'contested'] as const;

export interface SpecEntryParsed {
  category: string;
  keywords: string[];
  date: string;
  source?: string;
  ref?: string;
  description?: string;
  domain?: string;
  confidence?: ConfidenceLevel;
  conflictMarker?: string;
  conflictNote?: string;
  title: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

export interface ParseResult {
  entries: SpecEntryParsed[];
  legacy: LegacyEntry[];
  errors: ParseError[];
}

export interface LegacyEntry {
  title: string;
  content: string;
  lineStart: number;
}

export interface ParseError {
  line: number;
  message: string;
}

// ============================================================================
// Valid categories (shared with spec-loader)
// ============================================================================

export const VALID_CATEGORIES = ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'] as const;

export type ValidCategory = (typeof VALID_CATEGORIES)[number];

// ============================================================================
// Core regex
// ============================================================================

/** Matches `<spec-entry ...attributes...>...content...</spec-entry>` across lines */
const SPEC_ENTRY_RE = /<spec-entry\s+([^>]+)>([\s\S]*?)<\/spec-entry>/g;

/** Extracts key="value" attribute pairs */
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

/** Matches ### heading inside entry content */
const HEADING_RE = /^###\s+(.+)$/m;

/** Legacy format: ### [category] [date] title  OR  ### [date] type: title */
const LEGACY_HEADING_RE = /^###\s+(?:\[[\w-]+\]\s+)?\[(\d{4}-\d{2}-\d{2}(?:\s[\d:]+)?)\]\s*(.+)$/;

/** Date validation */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse spec file content into structured entries.
 * Returns new-format `<spec-entry>` entries, legacy heading entries, and any errors.
 */
export function parseSpecEntries(content: string): ParseResult {
  const entries: SpecEntryParsed[] = [];
  const errors: ParseError[] = [];

  // Track which character ranges are consumed by <spec-entry> blocks
  const consumed: Array<{ start: number; end: number }> = [];

  // Pass 1: Extract <spec-entry> blocks
  let match: RegExpExecArray | null;
  SPEC_ENTRY_RE.lastIndex = 0;

  while ((match = SPEC_ENTRY_RE.exec(content)) !== null) {
    const attrStr = match[1];
    const body = match[2];
    const blockStart = match.index;
    const blockEnd = blockStart + match[0].length;
    const lineStart = lineNumber(content, blockStart);
    const lineEnd = lineNumber(content, blockEnd);

    consumed.push({ start: blockStart, end: blockEnd });

    // Parse attributes
    const attrs = parseAttributes(attrStr);

    // Extract title: attribute > ### heading > empty
    const titleMatch = body.match(HEADING_RE);
    const title = attrs.title || (titleMatch ? titleMatch[1].trim() : '');

    // Validate and build entry
    const ref = attrs.ref || undefined;

    const confidence = attrs.confidence as ConfidenceLevel | undefined;
    const conflictMarker = attrs['conflict-marker'] || undefined;
    const conflictNote = attrs['conflict-note'] || undefined;

    const entry: SpecEntryParsed = {
      category: attrs.category ?? '',
      keywords: attrs.keywords ? attrs.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [],
      date: attrs.date ?? '',
      source: attrs.source,
      ref,
      description: attrs.description || undefined,
      domain: attrs.domain || undefined,
      confidence: confidence && VALID_CONFIDENCE_LEVELS.includes(confidence) ? confidence : undefined,
      conflictMarker,
      conflictNote,
      title,
      content: body.trim(),
      lineStart,
      lineEnd,
    };

    entries.push(entry);

    // Collect validation errors
    const validationErrors = validateSpecEntry(entry);
    for (const msg of validationErrors) {
      errors.push({ line: lineStart, message: msg });
    }
  }

  // Pass 2: Extract legacy entries from remaining text
  const legacy = parseLegacyEntries(content, consumed);

  return { entries, legacy, errors };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a single parsed entry. Returns array of error messages (empty = valid).
 */
export function validateSpecEntry(entry: SpecEntryParsed): string[] {
  const errors: string[] = [];

  if (!entry.category) {
    errors.push('Missing required attribute: category');
  } else if (!VALID_CATEGORIES.includes(entry.category as ValidCategory)) {
    errors.push(`Invalid category "${entry.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (entry.keywords.length === 0) {
    errors.push('Missing required attribute: keywords (need at least 1)');
  }

  if (!entry.date) {
    errors.push('Missing required attribute: date');
  } else if (!DATE_RE.test(entry.date)) {
    errors.push(`Invalid date format "${entry.date}". Expected YYYY-MM-DD`);
  }

  return errors;
}

/**
 * Validate that entry category matches the expected file category.
 */
export function validateCategoryMatch(entry: SpecEntryParsed, fileCategory: string): string | null {
  if (entry.category && entry.category !== fileCategory) {
    return `Entry category "${entry.category}" does not match file category "${fileCategory}"`;
  }
  return null;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format parsed entries for display output.
 * Strips `<spec-entry>` tags, shows clean content.
 * If keyword provided, highlights matched entries.
 */
export function formatSpecEntries(entries: SpecEntryParsed[], keyword?: string): string {
  const filtered = keyword
    ? entries.filter(e => e.keywords.includes(keyword.toLowerCase()))
    : entries;

  if (filtered.length === 0) return '';

  const normal = filtered.filter(e => e.confidence !== 'contested');
  const contested = filtered.filter(e => e.confidence === 'contested');

  const parts: string[] = [];
  if (normal.length > 0) {
    parts.push(normal.map(formatEntryClean).join('\n\n---\n\n'));
  }
  if (contested.length > 0) {
    parts.push(`> **${contested.length} contested entries** (pending audit review)\n\n` +
      contested.map(formatEntryClean).join('\n\n---\n\n'));
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Format a single parsed entry as clean markdown with metadata line.
 *
 * Input content:  `### Title\n\nBody`
 * Output:         `### Title\n> category · kw1, kw2 · date · source\n\nBody`
 */
const CONFIDENCE_BADGES: Record<string, string> = {
  contested: '[CONTESTED]',
  low: '[LOW CONFIDENCE]',
};

function formatEntryClean(e: SpecEntryParsed): string {
  const meta: string[] = [];

  const badge = e.confidence ? CONFIDENCE_BADGES[e.confidence] : undefined;
  if (badge) meta.push(badge);

  if (e.category) meta.push(e.category);
  if (e.keywords.length > 0) meta.push(e.keywords.join(', '));
  if (e.date) meta.push(e.date);
  if (e.source) meta.push(e.source);

  if (meta.length === 0 && !e.ref && !e.conflictNote) return e.content;

  const metaLine = meta.length > 0 ? `> ${meta.join(' \u00b7 ')}` : '';

  let conflictLine = '';
  if (e.conflictNote) {
    conflictLine = `\n> Conflict: ${e.conflictNote}`;
    if (e.conflictMarker) conflictLine += ` (${e.conflictMarker})`;
  }

  let refLine = '';
  if (e.ref) {
    const refStem = e.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
    const refSlug = refStem.replace(/^(KNW|TIP|TPL|RCP|REF|DCS|AST|BLP|DOC)-/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const refId = `knowhow-${refSlug}`;
    refLine = `\n\u2192 Detail: maestro wiki load ${refId}`;
  }

  const idx = e.content.indexOf('\n');
  if (idx !== -1 && e.content.trimStart().startsWith('###')) {
    return e.content.slice(0, idx) + (metaLine ? '\n' + metaLine : '') + conflictLine + refLine + e.content.slice(idx);
  }

  return (metaLine ? metaLine + '\n\n' : '') + e.content + conflictLine + refLine;
}

/**
 * Format a single entry for writing to a spec file.
 * Writes `category=` attribute as the primary classifier.
 */
export function formatNewEntry(
  category: string,
  keywords: string[],
  date: string,
  title: string,
  content: string,
  source?: string,
  ref?: string,
  description?: string,
  confidence?: ConfidenceLevel,
  conflictMarker?: string,
  conflictNote?: string,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kwStr = keywords.map(k => k.toLowerCase().trim()).filter(Boolean).join(',');
  const sourceAttr = source ? ` source="${esc(source)}"` : '';
  const refAttr = ref ? ` ref="${esc(ref)}"` : '';
  const descAttr = description ? ` description="${esc(description)}"` : '';
  const titleAttr = ` title="${esc(title)}"`;
  const confidenceAttr = confidence ? ` confidence="${confidence}"` : '';
  const conflictMarkerAttr = conflictMarker ? ` conflict-marker="${conflictMarker}"` : '';
  const conflictNoteAttr = conflictNote ? ` conflict-note="${conflictNote}"` : '';

  return `<spec-entry category="${category}" keywords="${kwStr}" date="${date}"${titleAttr}${descAttr}${sourceAttr}${refAttr}${confidenceAttr}${conflictMarkerAttr}${conflictNoteAttr}>\n\n### ${title}\n\n${content}\n\n</spec-entry>`;
}

// ============================================================================
// Internal helpers
// ============================================================================

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function lineNumber(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Parse legacy heading-based entries from text not consumed by <spec-entry> blocks.
 */
function parseLegacyEntries(
  content: string,
  consumed: Array<{ start: number; end: number }>,
): LegacyEntry[] {
  const lines = content.split('\n');
  const legacy: LegacyEntry[] = [];

  // Build a set of line numbers that are inside <spec-entry> blocks
  const consumedLines = new Set<number>();
  for (const range of consumed) {
    const startLine = lineNumber(content, range.start);
    const endLine = lineNumber(content, range.end);
    for (let i = startLine; i <= endLine; i++) {
      consumedLines.add(i);
    }
  }

  let current: { title: string; bodyLines: string[]; lineStart: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    if (consumedLines.has(lineNum)) continue;

    const line = lines[i];
    const m = line.match(LEGACY_HEADING_RE);
    if (m) {
      if (current) {
        const body = current.bodyLines.join('\n').trim();
        if (body) {
          legacy.push({ title: current.title, content: `### ${current.title}\n\n${body}`, lineStart: current.lineStart });
        }
      }
      current = { title: m[2].trim(), bodyLines: [], lineStart: lineNum };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    const body = current.bodyLines.join('\n').trim();
    if (body) {
      legacy.push({ title: current.title, content: `### ${current.title}\n\n${body}`, lineStart: current.lineStart });
    }
  }

  return legacy;
}
