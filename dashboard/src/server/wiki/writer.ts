import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir, lstat, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { WikiEntry } from './wiki-types.js';
import type { WikiIndexer } from './wiki-indexer.js';
import { parseFrontmatter } from './frontmatter-util.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[\w.-]+$/;

export type WritableType = 'spec' | 'memory' | 'note';

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

    const targetPath = this.resolveTargetPath(req.type, req.slug);
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

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private assertWritableType(type: string): asserts type is WritableType {
    if (type !== 'spec' && type !== 'memory' && type !== 'note') {
      throw new WikiWriteError('BAD_REQUEST', `type '${type}' is not writable`);
    }
  }

  private resolveTargetPath(type: WritableType, slug: string): string {
    let rel: string;
    if (type === 'spec') {
      rel = `specs/${slug}.md`;
    } else {
      // memory | note → memory/<PREFIX>-<slug>.md
      const prefix = type === 'note' ? 'TIP' : 'MEM';
      rel = `memory/${prefix}-${slug}.md`;
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
    return top === 'specs' || top === 'memory';
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
