import { readFile, readdir, stat, lstat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { toForwardSlash } from '../../shared/utils.js';
import { parseFrontmatter } from './frontmatter-util.js';
import { parseSpecEntries } from './spec-entry-parser.js';
import { loadVirtualEntries } from './virtual-wiki-adapters.js';
import type {
  WikiEntry,
  WikiFilters,
  WikiIndex,
  WikiStatus,
  WikiNodeType,
  PersistedWikiIndex,
  PersistedEntry,
} from './wiki-types.js';
import { buildGraph, type WikiGraph } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, type InvertedIndex } from './search.js';

export interface WikiIndexerConfig {
  workflowRoot: string;
}

/**
 * WikiIndexer: single source of truth for the unified wiki index.
 *
 * Responsibilities:
 *   1. Walk `.workflow/` for known wiki sources.
 *   2. Parse frontmatter + infer missing fields.
 *   3. Adapt JSONL rows as virtual entries.
 *   4. Build backlinks from `related: [[id]]` frontmatter.
 *   5. Cache index + memoized graph + BM25 index.
 *   6. Single-flight rebuild with invalidate().
 */
export class WikiIndexer {
  private readonly workflowRoot: string;
  private cache: WikiIndex | null = null;
  private graphCache: WikiGraph | null = null;
  private searchCache: InvertedIndex | null = null;
  private inflight: Promise<WikiIndex> | null = null;

  constructor(config: WikiIndexerConfig) {
    this.workflowRoot = resolve(config.workflowRoot);
  }

  getWorkflowRoot(): string {
    return this.workflowRoot;
  }

  async get(): Promise<WikiIndex> {
    if (this.cache) return this.cache;
    return this.rebuild();
  }

  async rebuild(): Promise<WikiIndex> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const fileEntries = await this.scanFiles();
      const virtualEntries = await this.scanVirtual();
      const entries = [...fileEntries, ...virtualEntries];

      // Stable collision suffix
      const seen = new Map<string, number>();
      for (const d of entries) {
        const n = seen.get(d.id) ?? 0;
        if (n > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[wiki-indexer] id collision '${d.id}' — suffixing`);
          d.id = `${d.id}-${n + 1}`;
        }
        seen.set(d.id, n + 1);
      }

      const byId: Record<string, WikiEntry> = {};
      const byType = {
        project: [],
        roadmap: [],
        spec: [],
        issue: [],
        lesson: [],
        memory: [],
        note: [],
      } as Record<WikiNodeType, WikiEntry[]>;

      for (const d of entries) {
        byId[d.id] = d;
        byType[d.type].push(d);
      }

      const backlinks = this.buildBacklinks(entries, byId);
      const index: WikiIndex = {
        entries,
        byId,
        byType,
        backlinks,
        generatedAt: Date.now(),
      };
      this.cache = index;
      this.graphCache = null;
      this.searchCache = null;

      // Persist lightweight index to disk (fire-and-forget).
      this.persistIndex(index).catch(() => {});

      return index;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  invalidate(_changedAbsPath?: string): void {
    this.cache = null;
    this.graphCache = null;
    this.searchCache = null;
  }

  async query(filters: WikiFilters): Promise<WikiEntry[]> {
    const index = await this.get();
    // Non-q filters first (cheap), then BM25 if q is present.
    const base = filterEntries(index.entries, { ...filters, q: undefined });
    if (!filters.q || !filters.q.trim()) return base;
    const bm25 = await this.getSearchIndex();
    const ranked = searchBM25(bm25, filters.q);
    const allowed = new Set(base.map((d) => d.id));
    const out: WikiEntry[] = [];
    for (const r of ranked) {
      if (allowed.has(r.docId) && index.byId[r.docId]) {
        out.push(index.byId[r.docId]);
      }
    }
    return out;
  }

  async groups(filters?: WikiFilters): Promise<Record<WikiNodeType, WikiEntry[]>> {
    const source = filters ? await this.query(filters) : (await this.get()).entries;
    const out: Record<WikiNodeType, WikiEntry[]> = {
      project: [],
      roadmap: [],
      spec: [],
      issue: [],
      lesson: [],
      memory: [],
      note: [],
    };
    for (const d of source) out[d.type].push(d);
    return out;
  }

  async getGraph(): Promise<WikiGraph> {
    if (this.graphCache) return this.graphCache;
    const index = await this.get();
    this.graphCache = buildGraph(index);
    return this.graphCache;
  }

  async getSearchIndex(): Promise<InvertedIndex> {
    if (this.searchCache) return this.searchCache;
    const index = await this.get();
    this.searchCache = buildInvertedIndex(index.entries);
    return this.searchCache;
  }

  async search(query: string, limit = 50): Promise<WikiEntry[]> {
    const index = await this.get();
    const bm25 = await this.getSearchIndex();
    const ranked = searchBM25(bm25, query, limit);
    return ranked
      .map((r) => index.byId[r.docId])
      .filter((d): d is WikiEntry => Boolean(d));
  }

  // -------------------------------------------------------------------------
  // Walk
  // -------------------------------------------------------------------------

  private async scanFiles(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];

    const singletons: Array<{ rel: string; type: WikiNodeType }> = [
      { rel: 'project.md', type: 'project' },
      { rel: 'roadmap.md', type: 'roadmap' },
    ];
    for (const s of singletons) {
      const entry = await this.parseFileEntry(join(this.workflowRoot, s.rel), s.type);
      if (entry) out.push(entry);
    }

    // specs/*.md — container node + sub-nodes from <spec-entry> blocks
    for (const name of await safeReaddir(join(this.workflowRoot, 'specs'))) {
      if (extname(name).toLowerCase() !== '.md') continue;
      const absPath = join(this.workflowRoot, 'specs', name);
      const container = await this.parseFileEntry(absPath, 'spec');
      if (!container) continue;
      out.push(container);

      // Parse <spec-entry> blocks into sub-node WikiEntries
      const specEntries = parseSpecEntries(container.body, name, {
        category: container.category ?? undefined,
        keywords: container.tags,
      });
      for (const se of specEntries) {
        out.push({
          id: `spec-${se.id}`,
          type: 'spec',
          title: se.title,
          summary: se.content.slice(0, 240).replace(/\s+/g, ' '),
          tags: se.keywords,
          status: 'active',
          created: container.created,
          updated: container.updated,
          related: [],
          source: container.source,
          body: se.content,
          ext: { entryType: se.type, timestamp: se.timestamp },
          category: se.category || container.category,
          createdBy: container.createdBy,
          sourceRef: container.sourceRef,
          parent: container.id,
        });
      }
    }

    // memory/*.md  (MEM-* → memory, TIP-* → note, others → memory)
    for (const name of await safeReaddir(join(this.workflowRoot, 'memory'))) {
      if (extname(name).toLowerCase() !== '.md') continue;
      const upper = name.toUpperCase();
      const type: WikiNodeType = upper.startsWith('TIP-') ? 'note' : 'memory';
      const entry = await this.parseFileEntry(join(this.workflowRoot, 'memory', name), type);
      if (entry) out.push(entry);
    }

    return out;
  }

  private async scanVirtual(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];

    for (const name of await safeReaddir(join(this.workflowRoot, 'issues'))) {
      if (extname(name).toLowerCase() !== '.jsonl') continue;
      const abs = join(this.workflowRoot, 'issues', name);
      if (!this.isInsideRoot(abs)) continue;
      const rel = toForwardSlash(relative(this.workflowRoot, abs));
      out.push(...(await loadVirtualEntries(abs, 'issue', rel)));
    }

    for (const name of await safeReaddir(join(this.workflowRoot, 'learning'))) {
      if (extname(name).toLowerCase() !== '.jsonl') continue;
      const abs = join(this.workflowRoot, 'learning', name);
      if (!this.isInsideRoot(abs)) continue;
      const rel = toForwardSlash(relative(this.workflowRoot, abs));
      out.push(...(await loadVirtualEntries(abs, 'lesson', rel)));
    }

    return out;
  }

  private async parseFileEntry(
    absPath: string,
    type: WikiNodeType,
  ): Promise<WikiEntry | null> {
    if (!this.isInsideRoot(absPath)) return null;
    try {
      const ls = await lstat(absPath);
      if (ls.isSymbolicLink()) return null;
      if (!ls.isFile()) return null;
    } catch {
      return null;
    }

    let raw: string;
    let stats;
    try {
      raw = await readFile(absPath, 'utf-8');
      stats = await stat(absPath);
    } catch {
      return null;
    }

    const { data, content } = parseFrontmatter(raw);
    const fileName = basename(absPath);
    const stem = basename(fileName, extname(fileName));

    const title = asString(data.title) || firstHeading(content) || stem;
    const summary = asString(data.summary) || firstParagraph(content);
    const tags = extractTags(data);
    const status = asStatus(data.status) ?? inferStatus(type);
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);

    // Enrichment fields from frontmatter
    const category = asString(data.category) || null;
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = asString(data.sourceRef) || null;
    const parent = asString(data.parent) || null;

    const rel = toForwardSlash(relative(this.workflowRoot, absPath));
    // Memory/note files live under memory/ with MEM-<slug>.md or TIP-<slug>.md
    // naming. Strip the prefix from the id-generating stem so the id matches
    // what the WikiWriter produced at create time (`memory-<slug>`, `note-<slug>`).
    let idStem = stem;
    if (type === 'memory' && /^MEM-/i.test(stem)) idStem = stem.slice(4);
    else if (type === 'note' && /^TIP-/i.test(stem)) idStem = stem.slice(4);
    const id = `${type}-${slugify(idStem)}`;

    return {
      id,
      type,
      title,
      summary,
      tags,
      status,
      created: new Date(stats.birthtimeMs || stats.mtimeMs).toISOString(),
      updated: new Date(stats.mtimeMs).toISOString(),
      related,
      source: { kind: 'file', path: rel },
      body: content,
      ext,
      category,
      createdBy,
      sourceRef,
      parent,
    };
  }

  private buildBacklinks(
    entries: WikiEntry[],
    byId: Record<string, WikiEntry>,
  ): Record<string, string[]> {
    const bl: Record<string, string[]> = {};
    const titleIndex = new Map<string, string>();
    for (const d of entries) titleIndex.set(d.title.toLowerCase(), d.id);

    const push = (target: string, source: string) => {
      const resolved = resolveLink(target, byId, titleIndex);
      if (!resolved) return;
      if (!bl[resolved]) bl[resolved] = [];
      if (!bl[resolved].includes(source)) bl[resolved].push(source);
    };

    for (const d of entries) {
      for (const rel of d.related) push(rel, d.id);
      if (d.body) {
        const linkRe = /\[\[([^\]]+)\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(d.body))) push(m[1], d.id);
      }
    }
    return bl;
  }

  /**
   * Write a lightweight persistent index to `.workflow/wiki-index.json`.
   * Strips body/raw/ext to keep the file small and fast to parse externally.
   */
  private async persistIndex(index: WikiIndex): Promise<void> {
    const persisted: PersistedWikiIndex = {
      version: 2,
      generatedAt: index.generatedAt,
      entries: index.entries.map((e): PersistedEntry => ({
        id: e.id,
        type: e.type,
        title: e.title,
        summary: e.summary,
        tags: e.tags,
        status: e.status,
        created: e.created,
        updated: e.updated,
        category: e.category,
        createdBy: e.createdBy,
        sourceRef: e.sourceRef,
        parent: e.parent,
        related: e.related,
        source: e.source,
      })),
    };
    const target = join(this.workflowRoot, 'wiki-index.json');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(persisted, null, 2), 'utf-8');
  }

  isInsideRoot(absPath: string): boolean {
    const requested = resolve(absPath);
    return requested === this.workflowRoot || requested.startsWith(this.workflowRoot + sep);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStatus(value: unknown): WikiStatus | null {
  const allowed: WikiStatus[] = ['draft', 'active', 'completed', 'blocked', 'archived'];
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as WikiStatus)
    : null;
}

function inferStatus(type: WikiNodeType): WikiStatus {
  if (type === 'spec' || type === 'project' || type === 'roadmap') return 'active';
  return 'draft';
}

function firstHeading(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function firstParagraph(body: string): string {
  const withoutFm = body.replace(/^#\s+.+\n+/, '');
  const para = withoutFm.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? '';
  return para.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function extractTags(data: Record<string, unknown>): string[] {
  const tags = data.tags ?? data.keywords;
  if (!Array.isArray(tags)) return [];
  return tags.map(String).filter((s) => s.length > 0);
}

function normalizeRelated(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    // Block-array parser keeps surrounding quotes; strip them so
    // `"[[id]]"` and `[[id]]` both resolve.
    const unquoted = v.replace(/^["']|["']$/g, '');
    const m = unquoted.match(/^\[\[([^\]]+)\]\]$/);
    out.push(m ? m[1] : unquoted);
  }
  return out;
}

function extractExt(data: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    'title', 'summary', 'tags', 'status', 'related',
    'category', 'createdBy', 'sourceRef', 'parent',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!known.has(k)) out[k] = v;
  }
  return out;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveLink(
  target: string,
  byId: Record<string, WikiEntry>,
  titleIndex: Map<string, string>,
): string | null {
  if (byId[target]) return target;
  const hit = titleIndex.get(target.toLowerCase());
  return hit ?? null;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function filterEntries(entries: WikiEntry[], filters: WikiFilters): WikiEntry[] {
  return entries.filter((d) => {
    if (filters.type && d.type !== filters.type) return false;
    if (filters.tag && !d.tags.includes(filters.tag)) return false;
    if (filters.status && d.status !== filters.status) return false;
    if (filters.category && d.category !== filters.category) return false;
    if (filters.createdBy && d.createdBy !== filters.createdBy) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}
