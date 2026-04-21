/**
 * Specs Routes -- CRUD API for spec entries in .workflow/specs/*.md files.
 *
 * Each .md file has YAML frontmatter (title, readMode, priority, category, keywords)
 * and contains entries as heading-delimited sections within the markdown body.
 *
 * Entry format (closed-tag, written by dashboard POST and spec-add SKILL):
 *   <spec-entry category="coding" keywords="auth,token" date="2026-04-21">
 *   ### Title text
 *   Content paragraph(s)...
 *   </spec-entry>
 *
 * Legacy formats also parsed (backward-compatible):
 *   ### [type] [YYYY-MM-DD] Title text
 *   ### [YYYY-MM-DD] type: Title text
 *
 * Follows the Hono factory pattern used by issues.ts and mcp.ts.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { Hono } from 'hono';

import { parseFrontmatter, type ParsedFrontmatter } from '../wiki/frontmatter-util.js';
// Re-exported for legacy imports that expect these symbols from specs.ts
export { parseFrontmatter };
export type { ParsedFrontmatter };

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

interface SpecFileMeta {
  name: string;
  path: string;
  title: string;
  category: string;
  entryCount: number;
}

// ---------------------------------------------------------------------------
// Entry type detection
// ---------------------------------------------------------------------------

const ENTRY_TYPES = ['coding', 'arch', 'quality', 'debug', 'test', 'review', 'learning'] as const;
type EntryType = typeof ENTRY_TYPES[number];

/** Map file basenames to default entry types when heading lacks a marker. */
const FILE_TYPE_MAP: Record<string, EntryType> = {
  'learnings': 'learning',
  'coding-conventions': 'coding',
  'architecture-constraints': 'arch',
  'quality-rules': 'quality',
  'debug-notes': 'debug',
  'test-conventions': 'test',
  'review-standards': 'review',
};

/** Map file basenames to default category when frontmatter lacks one. */
const FILE_CATEGORY_MAP: Record<string, string> = {
  'learnings': 'learning',
  'coding-conventions': 'coding',
  'architecture-constraints': 'arch',
  'quality-rules': 'quality',
  'debug-notes': 'debug',
  'test-conventions': 'test',
  'review-standards': 'review',
};

/** Detect entry type from heading text or fall back to file-based default. */
function detectEntryType(heading: string, fileName: string): SpecEntry['type'] {
  const lower = heading.toLowerCase();
  // 1. Check [type] bracket format (exact, no substring issues)
  for (const t of ENTRY_TYPES) {
    if (lower.includes(`[${t}]`)) return t;
  }
  // 2. Check "type:" prefix with word boundary to avoid substring collisions
  //    (e.g. "debug:" should not match "bug:", "preview:" should not match "review:")
  for (const t of ENTRY_TYPES) {
    if (new RegExp(`\\b${t}\\s*:`).test(lower)) return t;
  }
  const stem = basename(fileName, extname(fileName));
  return FILE_TYPE_MAP[stem] ?? 'learning';
}

/** Strip [type], [date], and legacy "type:" prefix from heading to get clean title. */
function extractCleanTitle(heading: string): string {
  return heading
    .replace(/\[(coding|arch|quality|debug|test|review|learning|bug|pattern|decision|rule|validation)\]\s*/gi, '')
    .replace(/\[\d{4}-\d{2}-\d{2}\]\s*/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]*/g, '')
    .replace(/^(coding|arch|quality|debug|test|review|learning|bug|pattern|decision|rule|validation)\s*:\s*/i, '')
    .trim();
}

// Frontmatter parser now lives in ../docs/frontmatter-util.ts and is imported
// at the top of this file; removing duplicate declaration here.

// ---------------------------------------------------------------------------
// Markdown entry parser
// ---------------------------------------------------------------------------

/** Heading regex: matches ## or ### at start of line. */
const HEADING_RE = /^(#{2,3})\s+(.+)$/;

/** Regex for <spec-entry> closed-tag blocks */
const SPEC_ENTRY_TAG_RE = /<spec-entry\s+([^>]+)>([\s\S]*?)<\/spec-entry>/g;
const TAG_ATTR_RE = /([\w-]+)="([^"]*)"/g;

/**
 * Parse markdown body into SpecEntry objects.
 * First extracts <spec-entry> closed-tag blocks, then parses remaining text
 * with legacy heading-based parser.
 */
function parseEntries(body: string, fileName: string, frontmatter?: Record<string, unknown>): SpecEntry[] {
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

    // Parse attributes
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    TAG_ATTR_RE.lastIndex = 0;
    while ((attrMatch = TAG_ATTR_RE.exec(attrStr)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    // Extract title from first ### heading
    const titleMatch = innerContent.match(/^###\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : innerContent.split('\n')[0].trim();
    const type = attrs.category ?? detectEntryType(title, fileName);
    const id = `${stem}-${String(++entryIndex).padStart(3, '0')}`;
    const kws = attrs.keywords ? attrs.keywords.split(',').map(k => k.trim()) : [];

    entries.push({
      id,
      type,
      title,
      content: innerContent,
      file: fileName,
      timestamp: attrs.date ?? '',
      category: attrs.category ?? (typeof frontmatter?.category === 'string' ? frontmatter.category : (FILE_CATEGORY_MAP[stem] ?? 'general')),
      keywords: kws,
    });
  }

  // Pass 2: Parse remaining text with legacy heading-based parser
  // Remove consumed <spec-entry> blocks from body
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
    const dateMatch = sec.heading.match(/\[(\d{4}-\d{2}-\d{2})\]/) ?? sec.heading.match(/(\d{4}-\d{2}-\d{2})/);
    const timestamp = dateMatch ? dateMatch[1] : '';
    const title = extractCleanTitle(sec.heading) || sec.heading;
    const category = typeof frontmatter?.category === 'string'
      ? frontmatter.category
      : (FILE_CATEGORY_MAP[stem] ?? 'general');
    const keywords = Array.isArray(frontmatter?.keywords) ? frontmatter.keywords.map(String) : [];
    entries.push({ id, type, title, content, file: fileName, timestamp, category, keywords });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

async function getSpecsDir(workflowRoot: string): Promise<string> {
  return join(workflowRoot, 'specs');
}

async function listSpecFiles(specsDir: string): Promise<string[]> {
  try {
    const names = await readdir(specsDir);
    return names.filter(n => extname(n).toLowerCase() === '.md');
  } catch {
    return [];
  }
}

async function readSpecFile(specsDir: string, fileName: string): Promise<string> {
  return readFile(join(specsDir, fileName), 'utf-8');
}

async function writeSpecFile(specsDir: string, fileName: string, content: string): Promise<void> {
  await mkdir(specsDir, { recursive: true });
  await writeFile(join(specsDir, fileName), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Write lock (same pattern as issues.ts)
// ---------------------------------------------------------------------------

let writeLock: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve!: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Specs routes following the Hono factory pattern.
 *
 * GET    /api/specs           - list all spec entries across all .md files
 * GET    /api/specs/files     - list spec files with metadata
 * GET    /api/specs/file/:name - read a specific spec file content + entries
 * POST   /api/specs           - add a new entry to a spec file
 * DELETE /api/specs/:id       - remove an entry by ID
 */
export function createSpecsRoutes(workflowRoot: string | (() => string)): Hono {
  const app = new Hono();
  const resolveRoot = () => typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;

  // -------------------------------------------------------------------------
  // GET /api/specs — list all entries across all spec files
  // -------------------------------------------------------------------------

  app.get('/api/specs', async (c) => {
    try {
      const specsDir = await getSpecsDir(resolveRoot());
      const files = await listSpecFiles(specsDir);
      const allEntries: SpecEntry[] = [];

      for (const fileName of files) {
        const raw = await readSpecFile(specsDir, fileName);
        const { data, content } = parseFrontmatter(raw);
        const entries = parseEntries(content, fileName, data);
        allEntries.push(...entries);
      }

      return c.json({ entries: allEntries });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/specs/files — list spec files with metadata
  // -------------------------------------------------------------------------

  app.get('/api/specs/files', async (c) => {
    try {
      const specsDir = await getSpecsDir(resolveRoot());
      const fileNames = await listSpecFiles(specsDir);
      const files: SpecFileMeta[] = [];

      for (const fileName of fileNames) {
        const raw = await readSpecFile(specsDir, fileName);
        const { data, content } = parseFrontmatter(raw);
        const entries = parseEntries(content, fileName);
        files.push({
          name: fileName,
          path: `specs/${fileName}`,
          title: typeof data.title === 'string' ? data.title : basename(fileName, extname(fileName)),
          category: typeof data.category === 'string' ? data.category : (FILE_CATEGORY_MAP[basename(fileName, extname(fileName))] ?? 'general'),
          entryCount: entries.length,
        });
      }

      return c.json({ files });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/specs/file/:name — read a specific spec file
  // -------------------------------------------------------------------------

  app.get('/api/specs/file/:name', async (c) => {
    try {
      const name = c.req.param('name');
      // Sanitize: only allow alphanumeric, hyphens, underscores + .md
      if (!/^[\w-]+\.md$/i.test(name)) {
        return c.json({ error: 'Invalid file name' }, 400);
      }

      const specsDir = await getSpecsDir(resolveRoot());
      let raw: string;
      try {
        raw = await readSpecFile(specsDir, name);
      } catch {
        return c.json({ error: `File not found: ${name}` }, 404);
      }

      const { data, content } = parseFrontmatter(raw);
      const entries = parseEntries(content, name, data);

      return c.json({ name, content: raw, entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/specs — add a new entry
  // -------------------------------------------------------------------------

  app.post('/api/specs', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const { type, content, file } = body;

      if (typeof content !== 'string' || !content.trim()) {
        return c.json({ error: 'content is required' }, 400);
      }
      if (typeof file !== 'string' || !file.trim()) {
        return c.json({ error: 'file is required' }, 400);
      }
      // Sanitize filename
      const fileName = file.endsWith('.md') ? file : `${file}.md`;
      if (!/^[\w-]+\.md$/i.test(fileName)) {
        return c.json({ error: 'Invalid file name' }, 400);
      }

      const entryCategory = typeof type === 'string' && ENTRY_TYPES.includes(type as EntryType) ? type : 'learning';
      const date = new Date().toISOString().slice(0, 10);
      const firstLine = content.trim().split('\n')[0].substring(0, 80);
      // Extract keywords: take meaningful words from first line (3-5 terms)
      const kwCandidates = firstLine.toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3);
      const keywords = [...new Set(kwCandidates)].slice(0, 5).join(',');
      const entryBlock = `\n<spec-entry category="${entryCategory}" keywords="${keywords}" date="${date}">\n\n### ${firstLine}\n\n${content.trim()}\n\n</spec-entry>\n`;

      let newId = '';

      await withWriteLock(async () => {
        const specsDir = await getSpecsDir(resolveRoot());
        let existing = '';
        try {
          existing = await readSpecFile(specsDir, fileName);
        } catch {
          // File does not exist -- create with minimal frontmatter
          const stem = basename(fileName, extname(fileName));
          existing = `---\ntitle: "${stem}"\nreadMode: optional\npriority: medium\ncategory: general\nkeywords: []\n---\n\n# ${stem}\n`;
        }

        const updated = existing.trimEnd() + '\n' + entryBlock;
        await writeSpecFile(specsDir, fileName, updated);

        // Parse to get the new entry ID
        const { data: fm, content: body } = parseFrontmatter(updated);
        const entries = parseEntries(body, fileName, fm);
        if (entries.length > 0) {
          newId = entries[entries.length - 1].id;
        }
      });

      return c.json({ success: true, id: newId }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/specs/:id — remove an entry by ID
  // -------------------------------------------------------------------------

  app.delete('/api/specs/:id', async (c) => {
    try {
      const targetId = c.req.param('id');
      // ID format: <stem>-<nnn>  e.g. "learnings-003"
      const dashIdx = targetId.lastIndexOf('-');
      if (dashIdx === -1) {
        return c.json({ error: `Invalid entry ID format: ${targetId}` }, 400);
      }
      const stem = targetId.substring(0, dashIdx);
      if (!/^[\w-]+$/i.test(stem)) {
        return c.json({ error: 'Invalid entry ID format' }, 400);
      }
      const fileName = `${stem}.md`;

      let found = false;

      await withWriteLock(async () => {
        const specsDir = await getSpecsDir(resolveRoot());
        let raw: string;
        try {
          raw = await readSpecFile(specsDir, fileName);
        } catch {
          return;
        }

        const { data: fm2, content: body } = parseFrontmatter(raw);
        const entries = parseEntries(body, fileName, fm2);
        const target = entries.find(e => e.id === targetId);
        if (!target) return;

        found = true;

        // Remove the section from the raw file content.
        const rawLines = raw.split('\n');

        // Strategy 1: exact match with reconstructed unified-format heading
        let startLine = -1;
        if (target.timestamp && target.title) {
          const exact3 = `### [${target.type}] [${target.timestamp}] ${target.title}`;
          const exact2 = `## [${target.type}] [${target.timestamp}] ${target.title}`;
          for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim();
            if (trimmed === exact3 || trimmed === exact2) {
              startLine = i;
              break;
            }
          }
        }

        // Strategy 2: fallback — match heading containing clean title text
        if (startLine === -1) {
          for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim();
            if (!HEADING_RE.test(trimmed)) continue;
            if (trimmed.includes(target.title)) {
              startLine = i;
              break;
            }
          }
        }

        if (startLine === -1) return;

        // Find end: next heading of same or higher level, or EOF
        let endLine = rawLines.length;
        const startMatch = rawLines[startLine].match(HEADING_RE);
        const startLevel = startMatch ? startMatch[1].length : 3;

        for (let i = startLine + 1; i < rawLines.length; i++) {
          const m = rawLines[i].match(HEADING_RE);
          if (m && m[1].length <= startLevel) {
            endLine = i;
            break;
          }
        }

        // Remove lines [startLine, endLine) and any trailing blank lines
        const before = rawLines.slice(0, startLine);
        const after = rawLines.slice(endLine);

        // Trim trailing blank lines from 'before'
        while (before.length > 0 && before[before.length - 1].trim() === '') {
          before.pop();
        }

        const updated = before.join('\n') + '\n' + (after.length > 0 ? '\n' + after.join('\n') : '\n');
        await writeSpecFile(specsDir, fileName, updated);
      });

      if (!found) {
        return c.json({ error: `Entry not found: ${targetId}` }, 404);
      }
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
