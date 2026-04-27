import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir, lstat, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { WikiEntry } from './wiki-types.js';
import type { WikiIndexer } from './wiki-indexer.js';
import { parseFrontmatter } from './frontmatter-util.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[\w.-]+$/;

export type WritableType = 'spec' | 'knowhow';

export interface CreateWikiReq {
  type: WritableType;
  slug: string;
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  /** Content category (persisted to frontmatter). */
  category?: string;
  /** Creating command/skill name (persisted to frontmatter). */
  createdBy?: string;
  /** Source anchor: session ID, harvest fragment ID, etc. (persisted to frontmatter). */
  sourceRef?: string;
  /** Parent entry ID (persisted to frontmatter). */
  parent?: string;
}

export interface UpdateWikiReq {
  title?: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
  /** sha256 of the previous file bytes for optimistic concurrency. */
  expectedHash?: string;
}

export interface AppendEntryReq {
  /** Container entry ID, e.g. "spec-learnings". */
  containerId: string;
  /** Entry category (coding, arch, debug, learning, etc.). */
  category: string;
  /** Entry content (markdown body, without the <spec-entry> wrapper). */
  content: string;
  /** Optional keywords (comma-separated or array). */
  keywords?: string[] | string;
}

export class WikiWriteError extends Error {
  constructor(public code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN', message: string, public details?: unknown) {
    super(message);
    this.name = 'WikiWriteError';
  }
}

/**
 * WikiWriter — safe CRUD for real markdown wiki entries.
 *
 * Scope: only `spec | memory | note` entries backed by real `.md`
 * files. Virtual entries (issue/lesson), and the top-level `project.md` /
 * `roadmap.md` narratives are rejected.
 *
 * All writes invalidate the indexer cache on success so the next read
 * rebuilds. fs-watcher will fire its own `wiki:invalidated` event for the
 * same change; the single-flight guard on `WikiIndexer.rebuild()` prevents
 * duplicate work.
 */
export class WikiWriter {
  /** Per-path serializer: chains async writes so TOCTOU hash checks are safe. */
  private readonly pathLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly workflowRoot: string,
    private readonly indexer: WikiIndexer,
  ) {
    this.workflowRoot = resolve(workflowRoot);
  }

  /**
   * Serialize async operations touching the same `key`. Each caller's fn runs
   * after the previous one's promise settles, so read-modify-write sequences
   * don't interleave for a single path.
   */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.pathLocks.get(key) ?? Promise.resolve();
    const settled = prev.then(
      () => undefined,
      () => undefined,
    );
    const next = settled.then(fn);
    // Store the error-swallowed tail so later waiters don't inherit rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.pathLocks.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.pathLocks.get(key) === tail) {
        this.pathLocks.delete(key);
      }
    }
  }

  async create(req: CreateWikiReq): Promise<WikiEntry> {
    this.assertWritableType(req.type);
    if (!req.slug || !SLUG_RE.test(req.slug)) {
      throw new WikiWriteError('BAD_REQUEST', `invalid slug '${req.slug}' (expected kebab-case)`);
    }
    if (!req.title || !req.title.trim()) {
      throw new WikiWriteError('BAD_REQUEST', 'title is required');
    }

    const targetPath = this.resolveTargetPath(req.type, req.slug, req.category);
    if (await pathExists(targetPath)) {
      throw new WikiWriteError('CONFLICT', `file already exists: ${targetPath}`);
    }

    const fm: Record<string, unknown> = { title: req.title, ...(req.frontmatter ?? {}) };
    if (req.category) fm.category = req.category;
    if (req.createdBy) fm.createdBy = req.createdBy;
    if (req.sourceRef) fm.sourceRef = req.sourceRef;
    if (req.parent) fm.parent = req.parent;
    const serialized = serializeFrontmatter(fm);
    const content = `${serialized}\n${req.body}`;

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf-8');

    this.indexer.invalidate(targetPath);
    const index = await this.indexer.rebuild();
    const id = `${req.type}-${req.slug}`;
    const entry = index.byId[id];
    if (!entry) {
      throw new WikiWriteError('NOT_FOUND', `created entry not indexed: ${id}`);
    }
    return entry;
  }

  async update(id: string, req: UpdateWikiReq): Promise<WikiEntry> {
    if (!ID_RE.test(id)) {
      throw new WikiWriteError('BAD_REQUEST', `invalid id '${id}'`);
    }
    const index = await this.indexer.get();
    const current = index.byId[id];
    if (!current) {
      throw new WikiWriteError('NOT_FOUND', `entry not found: ${id}`);
    }
    if (current.source.kind !== 'file') {
      throw new WikiWriteError('FORBIDDEN', `cannot write virtual entry: ${id}`);
    }
    const absPath = resolve(join(this.workflowRoot, current.source.path));
    if (!this.isInsideRoot(absPath) || !this.isWritablePath(absPath)) {
      throw new WikiWriteError('FORBIDDEN', `entry path not writable: ${current.source.path}`);
    }
    // Spec files are multi-entry containers managed by the spec API.
    // Only frontmatter updates are safe; body overwrites would destroy
    // <spec-entry> blocks. Block body updates on specs/ paths.
    if (this.isSpecPath(absPath) && req.body !== undefined) {
      throw new WikiWriteError('FORBIDDEN', 'spec files cannot be body-updated via wiki — use spec-add / spec API instead');
    }

    return this.withLock(absPath, async () => {
      const ls = await safeLstat(absPath);
      if (!ls || ls.isSymbolicLink() || !ls.isFile()) {
        throw new WikiWriteError('NOT_FOUND', `file missing or not a regular file: ${absPath}`);
      }

      const prevBytes = await readFile(absPath);
      const prevHash = sha256(prevBytes);
      if (req.expectedHash && req.expectedHash !== prevHash) {
        throw new WikiWriteError('CONFLICT', 'hash mismatch', {
          currentHash: prevHash,
          currentBody: prevBytes.toString('utf-8'),
        });
      }

      const { frontmatter: currentFm, body: currentBody } = splitFrontmatterAndBody(prevBytes.toString('utf-8'));
      const nextFm: Record<string, unknown> = {
        ...currentFm,
        ...(req.frontmatter ?? {}),
      };
      if (req.title !== undefined) nextFm.title = req.title;
      const nextBody = req.body !== undefined ? req.body : currentBody;
      const content = `${serializeFrontmatter(nextFm)}\n${nextBody}`;

      await writeFile(absPath, content, 'utf-8');
      this.indexer.invalidate(absPath);
      const rebuilt = await this.indexer.rebuild();
      const entry = rebuilt.byId[id];
      if (!entry) {
        throw new WikiWriteError('NOT_FOUND', `updated entry vanished from index: ${id}`);
      }
      return entry;
    });
  }

  async remove(id: string): Promise<void> {
    if (!ID_RE.test(id)) {
      throw new WikiWriteError('BAD_REQUEST', `invalid id '${id}'`);
    }
    const index = await this.indexer.get();
    const current = index.byId[id];
    if (!current) {
      throw new WikiWriteError('NOT_FOUND', `entry not found: ${id}`);
    }
    if (current.source.kind !== 'file') {
      throw new WikiWriteError('FORBIDDEN', `cannot delete virtual entry: ${id}`);
    }
    const absPath = resolve(join(this.workflowRoot, current.source.path));
    if (!this.isInsideRoot(absPath) || !this.isWritablePath(absPath)) {
      throw new WikiWriteError('FORBIDDEN', `entry path not writable: ${current.source.path}`);
    }
    const ls = await safeLstat(absPath);
    if (!ls || ls.isSymbolicLink() || !ls.isFile()) {
      throw new WikiWriteError('NOT_FOUND', `file missing or not a regular file: ${absPath}`);
    }

    await unlink(absPath);
    this.indexer.invalidate(absPath);
    await this.indexer.rebuild();
  }

  /**
   * Append a `<spec-entry>` block to an existing spec container file.
   * Uses per-path locking, surfaces keywords to frontmatter, and
   * invalidates the wiki index. Returns the new sub-node WikiEntry.
   */
  async appendEntry(req: AppendEntryReq): Promise<WikiEntry> {
    const index = await this.indexer.get();
    const container = index.byId[req.containerId];
    if (!container) {
      throw new WikiWriteError('NOT_FOUND', `container not found: ${req.containerId}`);
    }
    if (container.source.kind !== 'file') {
      throw new WikiWriteError('FORBIDDEN', `cannot append to virtual entry: ${req.containerId}`);
    }
    const absPath = resolve(join(this.workflowRoot, container.source.path));
    if (!this.isInsideRoot(absPath) || !this.isSpecPath(absPath)) {
      throw new WikiWriteError('FORBIDDEN', `appendEntry only works on spec container files`);
    }

    const kws = Array.isArray(req.keywords)
      ? req.keywords
      : typeof req.keywords === 'string'
        ? req.keywords.split(',').map((k) => k.trim()).filter(Boolean)
        : [];

    const date = new Date().toISOString().slice(0, 10);
    const firstLine = req.content.trim().split('\n')[0].substring(0, 80);
    const kwStr = kws.length > 0 ? kws.join(',') : firstLine.toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 5)
      .join(',');

    const entryBlock = `\n<spec-entry category="${req.category}" keywords="${kwStr}" date="${date}">\n\n### ${firstLine}\n\n${req.content.trim()}\n\n</spec-entry>\n`;

    return this.withLock(absPath, async () => {
      let existing: string;
      try {
        existing = (await readFile(absPath, 'utf-8'));
      } catch {
        throw new WikiWriteError('NOT_FOUND', `container file missing: ${absPath}`);
      }

      const updated = existing.trimEnd() + '\n' + entryBlock;

      // Surface keywords to frontmatter
      const surfaced = surfaceKeywords(updated, kwStr.split(','));
      await writeFile(absPath, surfaced, 'utf-8');

      this.indexer.invalidate(absPath);
      const rebuilt = await this.indexer.rebuild();

      // Find the new sub-node (last entry under this container)
      const children = rebuilt.entries
        .filter((e) => e.parent === req.containerId)
        .sort((a, b) => a.id.localeCompare(b.id));
      const newest = children[children.length - 1];
      if (!newest) {
        throw new WikiWriteError('NOT_FOUND', `appended entry not found in rebuilt index`);
      }
      return newest;
    });
  }

  /**
   * Remove a spec sub-entry by its ID (e.g. `spec-learnings-003`).
   * Locates the `<spec-entry>` block or heading section in the container
   * file and surgically removes it.
   */
  async removeEntry(entryId: string): Promise<void> {
    if (!ID_RE.test(entryId)) {
      throw new WikiWriteError('BAD_REQUEST', `invalid entry id '${entryId}'`);
    }
    const index = await this.indexer.get();
    const entry = index.byId[entryId];
    if (!entry) {
      throw new WikiWriteError('NOT_FOUND', `entry not found: ${entryId}`);
    }
    if (!entry.parent) {
      throw new WikiWriteError('BAD_REQUEST', `${entryId} is a container — use remove() to delete the whole file`);
    }
    const container = index.byId[entry.parent];
    if (!container || container.source.kind !== 'file') {
      throw new WikiWriteError('NOT_FOUND', `parent container not found: ${entry.parent}`);
    }
    const absPath = resolve(join(this.workflowRoot, container.source.path));
    if (!this.isInsideRoot(absPath)) {
      throw new WikiWriteError('FORBIDDEN', `path not inside root`);
    }

    await this.withLock(absPath, async () => {
      let raw: string;
      try {
        raw = await readFile(absPath, 'utf-8');
      } catch {
        throw new WikiWriteError('NOT_FOUND', `container file missing`);
      }

      // Strategy 1: remove <spec-entry> block containing the entry title
      const tagRe = /<spec-entry\s+[^>]+>[\s\S]*?<\/spec-entry>/g;
      let matched = false;
      const cleaned = raw.replace(tagRe, (block) => {
        if (matched) return block;
        if (block.includes(entry.title)) {
          matched = true;
          return '';
        }
        return block;
      });

      // Strategy 2: heading-based removal fallback
      let result = cleaned;
      if (!matched) {
        const lines = raw.split('\n');
        const headingRe = /^(#{2,3})\s+(.+)$/;
        let startLine = -1;
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(headingRe);
          if (m && m[2].includes(entry.title)) {
            startLine = i;
            break;
          }
        }
        if (startLine >= 0) {
          const startMatch = lines[startLine].match(headingRe);
          const startLevel = startMatch ? startMatch[1].length : 3;
          let endLine = lines.length;
          for (let i = startLine + 1; i < lines.length; i++) {
            const m = lines[i].match(headingRe);
            if (m && m[1].length <= startLevel) { endLine = i; break; }
          }
          const before = lines.slice(0, startLine);
          while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
          const after = lines.slice(endLine);
          result = before.join('\n') + '\n' + (after.length > 0 ? '\n' + after.join('\n') : '\n');
          matched = true;
        }
      }

      if (!matched) {
        throw new WikiWriteError('NOT_FOUND', `could not locate entry block for: ${entryId}`);
      }

      // Clean up consecutive blank lines
      result = result.replace(/\n{3,}/g, '\n\n');
      await writeFile(absPath, result, 'utf-8');
      this.indexer.invalidate(absPath);
      await this.indexer.rebuild();
    });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private assertWritableType(type: string): asserts type is WritableType {
    if (type !== 'spec' && type !== 'knowhow') {
      throw new WikiWriteError('BAD_REQUEST', `type '${type}' is not writable`);
    }
  }

  private resolveTargetPath(type: WritableType, slug: string, category?: string): string {
    let rel: string;
    if (type === 'spec') {
      rel = `specs/${slug}.md`;
    } else {
      // knowhow → knowhow/<PREFIX>-<slug>.md
      const prefix = categoryToPrefix(category);
      rel = `knowhow/${prefix}-${slug}.md`;
    }
    const abs = resolve(join(this.workflowRoot, rel));
    if (!this.isInsideRoot(abs) || !this.isWritablePath(abs)) {
      throw new WikiWriteError('BAD_REQUEST', `slug resolves outside allowed subtree: ${rel}`);
    }
    return abs;
  }

  private isInsideRoot(absPath: string): boolean {
    const requested = resolve(absPath);
    return requested === this.workflowRoot || requested.startsWith(this.workflowRoot + sep);
  }

  private isWritablePath(absPath: string): boolean {
    const abs = resolve(absPath);
    const rel = abs.slice(this.workflowRoot.length + 1);
    const segs = rel.split(sep);
    if (segs.length === 0) return false;
    const top = segs[0];
    return top === 'specs' || top === 'knowhow';
  }

  private isSpecPath(absPath: string): boolean {
    const abs = resolve(absPath);
    const rel = abs.slice(this.workflowRoot.length + 1);
    return rel.split(sep)[0] === 'specs';
  }
}

// ---------------------------------------------------------------------------
// Frontmatter serialization (flat only — matches the lean parser)
// ---------------------------------------------------------------------------

export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
    } else if (typeof v === 'object') {
      // Nested objects aren't round-trippable through the lean parser.
      // eslint-disable-next-line no-console
      console.warn(`[wiki-writer] dropping non-serializable key '${k}' (nested object)`);
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function serializeScalar(v: unknown): string {
  if (typeof v === 'string') {
    if (/[:#\n"']/.test(v) || v.trim() !== v) {
      return JSON.stringify(v);
    }
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function splitFrontmatterAndBody(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const { data, content } = parseFrontmatter(raw);
  return { frontmatter: data, body: content };
}

// ---------------------------------------------------------------------------
// Small fs helpers
// ---------------------------------------------------------------------------

function categoryToPrefix(category?: string): string {
  switch (category) {
    case 'session':   return 'KNW';
    case 'tip':       return 'TIP';
    case 'template':  return 'TPL';
    case 'recipe':    return 'RCP';
    case 'reference': return 'REF';
    case 'decision':  return 'DCS';
    default:          return 'KNW';
  }
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

async function safeLstat(absPath: string) {
  try {
    return await lstat(absPath);
  } catch {
    return null;
  }
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Merge entry-level keywords into the file's frontmatter `keywords` array
 * so the wiki index can filter by tag at the file level.
 */
function surfaceKeywords(raw: string, newKeywords: string[]): string {
  const { data, content } = parseFrontmatter(raw);
  const existing: string[] = Array.isArray(data.keywords)
    ? data.keywords.map(String)
    : [];
  const merged = [...new Set([...existing, ...newKeywords.filter((k) => k.length > 0)])];
  if (merged.length === existing.length && merged.every((k, i) => k === existing[i])) {
    return raw;
  }
  data.keywords = merged;
  return serializeFrontmatter(data) + '\n' + content;
}
