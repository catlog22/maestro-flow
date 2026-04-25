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
import {
  parseSpecEntries,
  type SpecEntry,
  FILE_CATEGORY_MAP,
  HEADING_RE,
  detectEntryType,
  extractCleanTitle,
} from '../wiki/spec-entry-parser.js';
import { WikiWriter, WikiWriteError } from '../wiki/writer.js';

// Re-exported for legacy imports that expect these symbols from specs.ts
export { parseFrontmatter, parseSpecEntries };
export type { ParsedFrontmatter, SpecEntry };

interface SpecFileMeta {
  name: string;
  path: string;
  title: string;
  category: string;
  entryCount: number;
}

const ENTRY_TYPES = [
  'coding', 'arch', 'quality', 'debug', 'test', 'review', 'learning',
  'bug', 'pattern', 'decision', 'rule', 'validation',
] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

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

/**
 * Merge entry-level keywords into the file's frontmatter `keywords` array.
 * This surfaces spec-entry keywords to the wiki index (which reads frontmatter
 * tags/keywords), bridging the Spec→Wiki search gap.
 */
function surfaceKeywordsToFrontmatter(raw: string, newKeywords: string[]): string {
  const { data, content } = parseFrontmatter(raw);
  const existing: string[] = Array.isArray(data.keywords)
    ? data.keywords.map(String)
    : [];
  const merged = [...new Set([...existing, ...newKeywords.filter(k => k.length > 0)])];
  if (merged.length === existing.length && merged.every((k, i) => k === existing[i])) {
    return raw; // no change
  }
  data.keywords = merged;
  // Rebuild frontmatter block
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); }
      else { lines.push(`${k}:`); for (const item of v) lines.push(`  - ${item}`); }
    } else {
      const s = String(v);
      lines.push((/[:#\n"']/.test(s) || s.trim() !== s) ? `${k}: ${JSON.stringify(s)}` : `${k}: ${s}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n' + content;
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
export function createSpecsRoutes(
  workflowRoot: string | (() => string),
  writer?: WikiWriter,
): Hono {
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
        const entries = parseSpecEntries(content, fileName, data);
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
        const entries = parseSpecEntries(content, fileName);
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
      const entries = parseSpecEntries(content, name, data);

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
      const fileName = file.endsWith('.md') ? file : `${file}.md`;
      if (!/^[\w-]+\.md$/i.test(fileName)) {
        return c.json({ error: 'Invalid file name' }, 400);
      }

      const entryCategory = typeof type === 'string' && ENTRY_TYPES.includes(type as EntryType) ? type : 'learning';
      const stem = basename(fileName, extname(fileName));
      const containerId = `spec-${stem}`;

      // Delegate to WikiWriter when available (unified write path)
      if (writer) {
        try {
          const entry = await writer.appendEntry({
            containerId,
            category: entryCategory,
            content: content.trim(),
            keywords: typeof body.keywords === 'string' ? body.keywords : undefined,
          });
          return c.json({ success: true, id: entry.id }, 201);
        } catch (err) {
          if (err instanceof WikiWriteError) {
            const statusMap: Record<string, 400 | 403 | 404 | 409> = {
              BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
            };
            return c.json({ error: err.message }, statusMap[err.code] ?? 500);
          }
          throw err;
        }
      }

      // Fallback: direct file write (when no writer injected, e.g. in tests)
      const date = new Date().toISOString().slice(0, 10);
      const firstLine = content.trim().split('\n')[0].substring(0, 80);
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
          existing = `---\ntitle: "${stem}"\nreadMode: optional\npriority: medium\ncategory: general\nkeywords: []\n---\n\n# ${stem}\n`;
        }

        const updated = existing.trimEnd() + '\n' + entryBlock;
        const surfaced = surfaceKeywordsToFrontmatter(updated, keywords.split(','));
        await writeSpecFile(specsDir, fileName, surfaced);

        const { data: fm, content: parsedBody } = parseFrontmatter(surfaced);
        const entries = parseSpecEntries(parsedBody, fileName, fm);
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

      // Delegate to WikiWriter when available (unified write path).
      // Wiki entry IDs are prefixed: "spec-learnings-003" vs spec API "learnings-003".
      if (writer) {
        const wikiEntryId = targetId.startsWith('spec-') ? targetId : `spec-${targetId}`;
        try {
          await writer.removeEntry(wikiEntryId);
          return c.json({ success: true });
        } catch (err) {
          if (err instanceof WikiWriteError) {
            const statusMap: Record<string, 400 | 403 | 404 | 409> = {
              BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
            };
            return c.json({ error: err.message }, statusMap[err.code] ?? 500);
          }
          throw err;
        }
      }

      // Fallback: direct file manipulation (when no writer injected)
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
        const entries = parseSpecEntries(body, fileName, fm2);
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
