import { readFile, readdir, stat, lstat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { toForwardSlash } from '../../shared/utils.js';
import { parseFrontmatter } from './frontmatter-util.js';
import { parseSpecEntries, parseKnowhowEntries } from './spec-entry-parser.js';
import {
  adaptCodebaseDocIndex,
  adaptIssueRow,
  adaptKnowledgeGraph,
  crossReferenceKgWithDocIndex,
  loadSessionArchiveEntries,
  loadVirtualEntries,
  loadVirtualJsonEntries,
  loadClaudeCodeSessions,
  loadCodexSessions,
  cwdToClaudeProjectSlug,
} from './virtual-wiki-adapters.js';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type {
  WikiEntry,
  WikiFilters,
  WikiIndex,
  WikiStatus,
  WikiNodeType,
  WikiScope,
  PersistedWikiIndex,
  PersistedEntry,
} from './wiki-types.js';
import { buildGraph, type WikiGraph } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, searchBM25Planned, rerankByPhraseProximity, type InvertedIndex } from './search.js';
import type { EmbeddingIndex } from './embedding.js';

export interface LinkedWorkspaceConfig {
  name: string;
  workflowRoot: string;
  shareTypes: Array<'spec' | 'knowhow' | 'domain' | 'codebase'>;
}

export interface WikiIndexerConfig {
  workflowRoot: string;
  linkedWorkspaces?: LinkedWorkspaceConfig[];
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
  private readonly linkedWorkspaces: Array<{
    name: string;
    workflowRoot: string;
    shareTypes: Set<string>;
  }>;
  private cache: WikiIndex | null = null;
  private graphCache: WikiGraph | null = null;
  private searchCache: InvertedIndex | null = null;
  private embeddingCache: EmbeddingIndex | null = null;
  private embeddingInflight: Promise<EmbeddingIndex | null> | null = null;
  private embeddingGeneration = 0;
  private inflight: Promise<WikiIndex> | null = null;
  private mtimeSnapshot: Map<string, number> = new Map();

  constructor(config: WikiIndexerConfig) {
    this.workflowRoot = resolve(config.workflowRoot);
    this.linkedWorkspaces = (config.linkedWorkspaces ?? []).map(lw => ({
      name: lw.name,
      workflowRoot: resolve(lw.workflowRoot),
      shareTypes: new Set(lw.shareTypes),
    }));
  }

  getWorkflowRoot(): string {
    return this.workflowRoot;
  }

  async get(): Promise<WikiIndex> {
    if (this.cache) {
      if (!await this.hasSourceChanges()) return this.cache;
      this.cache = null;
      this.graphCache = null;
      this.searchCache = null;
      this.embeddingCache = null;
    }
    if (await this.tryLoadSearchCache()) {
      return this.cache!;
    }
    return this.rebuild();
  }

  private getSourcePaths(): { singletons: string[]; dirs: string[] } {
    const dirs = [
      join(this.workflowRoot, 'specs'),
      join(this.workflowRoot, 'knowhow'),
      join(this.workflowRoot, 'issues'),
      join(this.workflowRoot, 'domain'),
      join(this.workflowRoot, 'scratch'),
    ];
    for (const lw of this.linkedWorkspaces) {
      if (lw.shareTypes.has('spec')) dirs.push(join(lw.workflowRoot, 'specs'));
      if (lw.shareTypes.has('knowhow')) dirs.push(join(lw.workflowRoot, 'knowhow'));
      if (lw.shareTypes.has('domain')) dirs.push(join(lw.workflowRoot, 'domain'));
      if (lw.shareTypes.has('codebase')) dirs.push(join(lw.workflowRoot, 'codebase'));
    }

    // Monitor CLI session directories for new session detection
    const home = homedir();
    const projectCwd = dirname(this.workflowRoot);
    const projectSlug = cwdToClaudeProjectSlug(projectCwd);
    const claudeProjectDir = join(home, '.claude', 'projects', projectSlug);
    if (existsSync(claudeProjectDir)) dirs.push(claudeProjectDir);
    const codexSessionsDir = join(home, '.codex', 'sessions');
    if (existsSync(codexSessionsDir)) dirs.push(codexSessionsDir);

    const singletons = [
      join(this.workflowRoot, 'project.md'),
      join(this.workflowRoot, 'roadmap.md'),
    ];
    return { singletons, dirs };
  }

  private async hasSourceChanges(): Promise<boolean> {
    if (this.mtimeSnapshot.size === 0) return true;
    const { singletons, dirs } = this.getSourcePaths();
    const allPaths = [...singletons, ...dirs];
    const results = await Promise.allSettled(allPaths.map(p => stat(p)));
    for (let i = 0; i < allPaths.length; i++) {
      const p = allPaths[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        const prev = this.mtimeSnapshot.get(p);
        if (prev === undefined || result.value.mtimeMs !== prev) return true;
      } else {
        if (this.mtimeSnapshot.has(p)) return true;
      }
    }
    return false;
  }

  private async captureMtimeSnapshot(): Promise<Map<string, number>> {
    const snap = new Map<string, number>();
    const { singletons, dirs } = this.getSourcePaths();
    const allPaths = [...singletons, ...dirs];
    const results = await Promise.allSettled(allPaths.map(p => stat(p)));
    for (let i = 0; i < allPaths.length; i++) {
      if (results[i].status === 'fulfilled') {
        const st = (results[i] as PromiseFulfilledResult<Awaited<ReturnType<typeof stat>>>).value;
        snap.set(allPaths[i], Number(st.mtimeMs));
      }
    }
    return snap;
  }

  private async tryLoadSearchCache(): Promise<boolean> {
    const cachePath = join(this.workflowRoot, 'search-cache.json');
    if (!existsSync(cachePath)) return false;

    try {
      const raw = await readFile(cachePath, 'utf-8');
      const cached = JSON.parse(raw);
      if (cached.version !== 1 || !Array.isArray(cached.entries)) return false;

      const snapshot = new Map<string, number>(cached.mtimeSnapshot);
      this.mtimeSnapshot = snapshot;
      if (await this.hasSourceChanges()) {
        this.mtimeSnapshot = new Map();
        return false;
      }

      const entries: WikiEntry[] = cached.entries;
      const byId: Record<string, WikiEntry> = {};
      const byType = {
        project: [], roadmap: [], spec: [], issue: [],
        knowhow: [], note: [], domain: [],
      } as Record<WikiNodeType, WikiEntry[]>;

      for (const d of entries) {
        byId[d.id] = d;
        byType[d.type].push(d);
      }

      const backlinks = this.buildBacklinks(entries, byId);
      this.cache = { entries, byId, byType, backlinks, generatedAt: cached.generatedAt };
      return true;
    } catch {
      return false;
    }
  }

  private persistSearchCache(index: WikiIndex): void {
    const entries = index.entries.map(e => ({
      id: e.id, type: e.type, title: e.title, summary: e.summary,
      tags: e.tags, status: e.status, created: e.created, updated: e.updated,
      related: e.related, source: e.source, body: e.body, ext: e.ext,
      scope: e.scope, category: e.category, specCategory: e.specCategory,
      createdBy: e.createdBy, sourceRef: e.sourceRef, parent: e.parent,
    }));
    try {
      const target = join(this.workflowRoot, 'search-cache.json');
      const data = JSON.stringify({
        version: 1,
        generatedAt: index.generatedAt,
        mtimeSnapshot: [...this.mtimeSnapshot.entries()],
        entries,
      });
      writeFile(target, data, 'utf-8').catch(() => {});
    } catch { /* best-effort */ }
  }

  async rebuild(): Promise<WikiIndex> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      // Parallel: file scan + virtual entries + linked workspaces
      const [fileEntries, virtualEntries, linkedEntries] = await Promise.all([
        this.scanFiles(),
        this.scanVirtual(),
        this.scanLinkedWorkspaces(),
      ]);
      const entries = [...fileEntries, ...virtualEntries, ...linkedEntries];

      // Stable collision suffix — use original id for counting so the
      // third duplicate becomes -3 (not another -2).
      // Collisions are expected across multi-source JSONL files; warn only
      // when MAESTRO_DEBUG is set to avoid polluting CLI search output.
      const seen = new Map<string, number>();
      const debugCollisions = process.env.MAESTRO_DEBUG === '1';
      let collisionCount = 0;
      for (const d of entries) {
        const original = d.id;
        const n = seen.get(original) ?? 0;
        if (n > 0) {
          if (debugCollisions) {
            // eslint-disable-next-line no-console
            console.warn(`[wiki-indexer] id collision '${original}' — suffixing to ${original}-${n + 1}`);
          }
          d.id = `${original}-${n + 1}`;
          collisionCount++;
        }
        seen.set(original, n + 1);
      }
      if (collisionCount > 0 && debugCollisions) {
        // eslint-disable-next-line no-console
        console.warn(`[wiki-indexer] ${collisionCount} id collision(s) resolved by suffixing`);
      }

      const byId: Record<string, WikiEntry> = {};
      const byType = {
        project: [],
        roadmap: [],
        spec: [],
        issue: [],
        knowhow: [],
        note: [],
        domain: [],
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

      // Snapshot mtimes of source directories for incremental staleness check
      this.mtimeSnapshot = await this.captureMtimeSnapshot();

      // Persist lightweight index to disk (fire-and-forget).
      this.persistIndex(index).catch(() => {});
      this.persistSearchCache(index);

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
    this.embeddingCache = null;
    this.embeddingInflight = null;
    this.embeddingGeneration++;
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
      knowhow: [],
      note: [],
      domain: [],
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

  async searchWithScores(query: string, limit = 50): Promise<Array<{ entry: WikiEntry; score: number }>> {
    return (await this.searchWithMeta(query, limit)).results;
  }

  async searchWithMeta(query: string, limit = 50, options?: { skipEmbedding?: boolean }): Promise<{
    results: Array<{ entry: WikiEntry; score: number }>;
    embeddingUsed: boolean;
    embeddingDocs: number;
  }> {
    const index = await this.get();

    // Parallel: BM25 index build + embedding index load
    const [bm25, embIdx] = await Promise.all([
      this.getSearchIndex(),
      options?.skipEmbedding ? null : this.getEmbeddingIndex(),
    ]);
    const bm25Results = searchBM25Planned(bm25, query, limit * 2);

    if (embIdx && embIdx.docIds.length > 0) {
      try {
        const { embedQuery, vectorSearch, mergeHybrid } = await import('./embedding.js');
        const qVec = await embedQuery(query);
        const vecResults = vectorSearch(qVec, embIdx, limit * 2);
        const merged = mergeHybrid(bm25Results, vecResults, limit * 3);
        let out: Array<{ entry: WikiEntry; score: number }> = [];
        for (const r of merged) {
          const entry = index.byId[r.docId];
          if (entry) out.push({ entry, score: r.score });
        }
        out = rerankByPhraseProximity(out, query);
        return { results: out.slice(0, limit), embeddingUsed: true, embeddingDocs: embIdx.docIds.length };
      } catch (e: unknown) {
        if (process.env.DEBUG || process.env.MAESTRO_DEBUG) {
          console.error(`[embedding] query failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    let out: Array<{ entry: WikiEntry; score: number }> = [];
    for (const r of bm25Results.slice(0, limit * 3)) {
      const entry = index.byId[r.docId];
      if (entry) out.push({ entry, score: r.score });
    }
    out = rerankByPhraseProximity(out, query);
    return { results: out.slice(0, limit), embeddingUsed: false, embeddingDocs: 0 };
  }

  async getEmbeddingIndex(): Promise<EmbeddingIndex | null> {
    if (this.embeddingCache) return this.embeddingCache;
    if (this.embeddingInflight) return this.embeddingInflight;

    const gen = this.embeddingGeneration;
    this.embeddingInflight = this.loadOrBuildEmbeddings();
    const result = await this.embeddingInflight;
    if (this.embeddingGeneration === gen) {
      this.embeddingInflight = null;
      this.embeddingCache = result;
    }
    return result;
  }

  private async loadOrBuildEmbeddings(): Promise<EmbeddingIndex | null> {
    try {
      const { isAvailable, getUnavailableReason, loadEmbeddingIndex, buildEmbeddingIndex, saveEmbeddingIndex } = await import('./embedding.js');
      if (!await isAvailable()) {
        const reason = getUnavailableReason?.() ?? 'unknown';
        if (process.env.DEBUG || process.env.MAESTRO_DEBUG) {
          console.error(`[embedding] unavailable: ${reason}`);
        }
        return null;
      }

      const cached = loadEmbeddingIndex(this.workflowRoot);
      const index = await this.get();

      // KG nodes: include high/medium semantic density types, skip low-density bulk
      const KG_EMBED_NODE_TYPES = new Set(['module', 'class', 'kg-layer', 'kg-tour-step']);
      const KG_SKIP_NODE_TYPES = new Set(['file', 'function', 'interface', 'type', 'const', 'enum']);

      const docs = index.entries
        .filter(e => {
          const vk = e.ext?.virtualKind as string | undefined;
          if (vk !== 'kg-node' && vk !== 'kg-layer' && vk !== 'kg-tour-step') return true;
          if (vk === 'kg-layer' || vk === 'kg-tour-step') return true;
          const nt = e.ext?.nodeType as string | undefined;
          if (nt && KG_SKIP_NODE_TYPES.has(nt)) return false;
          return nt ? KG_EMBED_NODE_TYPES.has(nt) : false;
        })
        .map(e => {
          const vk = e.ext?.virtualKind as string | undefined;
          if (vk === 'kg-node' || vk === 'kg-layer' || vk === 'kg-tour-step') {
            return this.enrichKgDocForEmbedding(e, index);
          }
          return { id: e.id, title: e.title, summary: e.summary, tags: e.tags, body: e.body };
        });

      const { getModelId, hashDocContent } = await import('./embedding.js');
      const activeModel = getModelId();
      const modelMatch = cached && cached.modelId === activeModel;
      const currentHashes = modelMatch ? docs.map(hashDocContent) : undefined;

      if (currentHashes && cached) {
        const cachedHashMap = new Map<string, string>();
        if (cached.contentHashes) {
          for (let i = 0; i < cached.docIds.length; i++) {
            cachedHashMap.set(cached.docIds[i], cached.contentHashes[i] ?? '');
          }
        }
        const unchanged = cached.docIds.length === docs.length
          && cachedHashMap.size > 0
          && docs.every((d, i) => cachedHashMap.get(d.id) === currentHashes[i]);
        if (unchanged) return cached;
      }

      try {
        const embIdx = await buildEmbeddingIndex(docs, cached, currentHashes);
        saveEmbeddingIndex(embIdx, this.workflowRoot);
        return embIdx;
      } catch (buildErr: unknown) {
        if (process.env.DEBUG || process.env.MAESTRO_DEBUG) {
          console.error(`[embedding] build failed: ${buildErr instanceof Error ? buildErr.message : buildErr}`);
        }
        if (cached) return cached;
        return null;
      }
    } catch (e: unknown) {
      if (process.env.DEBUG || process.env.MAESTRO_DEBUG) {
        console.error(`[embedding] unavailable: ${e instanceof Error ? e.message : e}`);
      }
      return null;
    }
  }

  private enrichKgDocForEmbedding(
    e: WikiEntry,
    index: WikiIndex,
  ): { id: string; title: string; summary: string; tags: string[]; body: string } {
    const parts: string[] = [];
    const nt = (e.ext?.nodeType as string) || (e.ext?.virtualKind as string) || '';
    const fp = e.ext?.filePath as string | undefined;

    if (nt) parts.push(`[${nt}]`);
    parts.push(e.title);
    if (e.summary) parts.push(e.summary);
    if (fp) parts.push(`file: ${fp}`);

    const edges = (e.ext?.kgEdges as Array<{ target: string; type: string }>) ?? [];
    if (edges.length > 0) {
      const edgeDescs = edges.slice(0, 8).map(edge => {
        const target = index.byId[edge.target];
        return target ? `${edge.type} → ${target.title}` : null;
      }).filter(Boolean);
      if (edgeDescs.length > 0) parts.push('relations: ' + edgeDescs.join(', '));
    }

    if (e.tags.length > 0) {
      const meaningful = e.tags.filter(t => !t.startsWith('kg:') && t !== 'kg');
      if (meaningful.length > 0) parts.push('tags: ' + meaningful.join(', '));
    }

    return {
      id: e.id,
      title: e.title,
      summary: e.summary,
      tags: e.tags,
      body: parts.join('. '),
    };
  }

  async search(query: string, limit = 50): Promise<WikiEntry[]> {
    return (await this.searchWithScores(query, limit)).map(r => r.entry);
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

    // specs — scan all scope directories (global, project, team, personal)
    const specScopes = this.resolveSpecScopes();
    for (const { dir, scope, idPrefix, sourcePrefix } of specScopes) {
      for (const name of await safeReaddir(dir)) {
        if (extname(name).toLowerCase() !== '.md') continue;
        const absPath = join(dir, name);
        const container = await this.parseFileEntry(absPath, 'spec');
        if (!container) continue;

        // Scoped ID: spec:{scope}:{stem} to prevent cross-scope collisions
        const stem = basename(name, extname(name));
        container.id = `${idPrefix}${slugify(stem)}`;
        container.scope = scope;
        container.source = { kind: 'file', path: `${sourcePrefix}${name}` };
        out.push(container);

        // Parse <spec-entry> blocks into sub-node WikiEntries
        const specEntries = parseSpecEntries(container.body, name, {
          category: container.category ?? undefined,
          keywords: container.tags,
        });
        for (const se of specEntries) {
          const related: string[] = [];
          if (se.ref) {
            const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
            // Derive ref target the same way as the knowhow container id (parseFileEntry
            // uses `knowhow-${slugify(stem)}`, which keeps the type prefix). Stripping the
            // prefix here produced target ≠ id → broken links for RCP/REF/DCS/etc.
            const refSlug = slugify(refStem);
            related.push(`knowhow-${refSlug}`);
          }
          out.push({
            id: `${idPrefix}${se.id}`,
            type: 'spec',
            title: se.title,
            summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
            tags: se.keywords,
            status: 'active',
            created: container.created,
            updated: container.updated,
            related,
            source: container.source,
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}) },
            scope,
            category: se.category || container.category,
            specCategory: container.specCategory,
            createdBy: container.createdBy,
            sourceRef: container.sourceRef,
            parent: container.id,
          });
        }
      }
    }

    // knowhow/*.md — recursive scan supports both flat and sub-folder layouts
    const knowhowEntries = await this.scanKnowhowDir(join(this.workflowRoot, 'knowhow'));
    for (const { name, absPath, entry } of knowhowEntries) {
      if (entry) {
        // Only derive category from file prefix if no frontmatter category
        if (!entry.category) {
          const upper = name.toUpperCase();
          if (upper.startsWith('KNW-')) entry.category = 'session';
          else if (upper.startsWith('TPL-')) entry.category = 'template';
          else if (upper.startsWith('RCP-')) entry.category = 'recipe';
          else if (upper.startsWith('REF-')) entry.category = 'reference';
          else if (upper.startsWith('DCS-')) entry.category = 'decision';
          else if (upper.startsWith('TIP-')) entry.category = 'tip';
          else if (upper.startsWith('AST-')) entry.category = 'asset';
          else if (upper.startsWith('BLP-')) entry.category = 'blueprint';
          else if (upper.startsWith('DOC-')) entry.category = 'document';
        }
        out.push(entry);

        // Parse <knowhow-entry> blocks into sub-node WikiEntries
        const knowhowSubEntries = parseKnowhowEntries(entry.body, name, {
          category: entry.category ?? undefined,
          keywords: entry.tags,
        });
        for (const se of knowhowSubEntries) {
          const related: string[] = [];
          if (se.ref) {
            const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
            // Derive ref target the same way as the knowhow container id (parseFileEntry
            // uses `knowhow-${slugify(stem)}`, which keeps the type prefix). Stripping the
            // prefix here produced target ≠ id → broken links for RCP/REF/DCS/etc.
            const refSlug = slugify(refStem);
            related.push(`knowhow-${refSlug}`);
          }
          out.push({
            id: `knowhow-${se.id}`,
            type: 'knowhow' as const,
            title: se.title,
            summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
            tags: se.keywords,
            status: 'active' as const,
            created: entry.created,
            updated: entry.updated,
            related,
            source: entry.source,
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}) },
            scope: null,
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: entry.sourceRef,
            parent: entry.id,
          });
        }
      }
    }

    // domain/glossary.json → domain WikiEntries
    const domainEntries = await this.scanDomain();
    out.push(...domainEntries);

    // scratch/*/*.md — session working documents (lowest search priority via SCRATCH_FIELD_CONFIGS)
    const scratchEntries = await this.scanScratchDocuments();
    out.push(...scratchEntries);

    return out;
  }

  /**
   * Recursively scan knowhow directory (supports both flat and sub-folder layouts).
   */
  private async scanKnowhowDir(dir: string): Promise<Array<{ name: string; absPath: string; entry: WikiEntry | null }>> {
    const results: Array<{ name: string; absPath: string; entry: WikiEntry | null }> = [];
    for (const name of await safeReaddir(dir)) {
      const fullPath = join(dir, name);
      let stats: Awaited<ReturnType<typeof stat>> | null = null;
      try { stats = await stat(fullPath); } catch { continue; }

      if (stats.isDirectory()) {
        const nested = await this.scanKnowhowDir(fullPath);
        results.push(...nested);
      } else if (stats.isFile() && extname(name).toLowerCase() === '.md') {
        const entry = await this.parseFileEntry(fullPath, 'knowhow');
        results.push({ name, absPath: fullPath, entry });
      }
    }
    return results;
  }

  /**
   * Scan .workflow/scratch session directories for .md working documents.
   * These are indexed as 'note' type with ext.virtualKind='scratch-doc'
   * so search.ts applies SCRATCH_FIELD_CONFIGS (lowest BM25 weight).
   */
  private async scanScratchDocuments(): Promise<WikiEntry[]> {
    const scratchRoot = join(this.workflowRoot, 'scratch');
    if (!existsSync(scratchRoot)) return [];
    const out: WikiEntry[] = [];

    for (const sessionName of await safeReaddir(scratchRoot)) {
      const sessionDir = join(scratchRoot, sessionName);
      let dirStat: Awaited<ReturnType<typeof stat>> | null = null;
      try { dirStat = await stat(sessionDir); } catch { continue; }
      if (!dirStat.isDirectory()) continue;

      for (const fileName of await safeReaddir(sessionDir)) {
        if (extname(fileName).toLowerCase() !== '.md') continue;
        const absPath = join(sessionDir, fileName);
        const entry = await this.parseFileEntry(absPath, 'note');
        if (!entry) continue;

        const stem = basename(fileName, extname(fileName));
        entry.id = `scratch-${slugify(sessionName)}-${slugify(stem)}`;
        entry.ext = { ...entry.ext, virtualKind: 'scratch-doc', sessionDir: sessionName };
        entry.category = entry.category || 'scratch';
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Scan .workflow/domain/glossary.json and produce WikiEntry[] for each term.
   */
  private async scanDomain(): Promise<WikiEntry[]> {
    const glossaryPath = join(this.workflowRoot, 'domain', 'glossary.json');
    try {
      const raw = await readFile(glossaryPath, 'utf-8');
      const glossary = JSON.parse(raw);
      if (!Array.isArray(glossary.terms)) return [];

      const now = new Date().toISOString();
      let glossaryStat: Awaited<ReturnType<typeof stat>>;
      try { glossaryStat = await stat(glossaryPath); } catch { return []; }
      const fileDate = new Date(glossaryStat.mtimeMs).toISOString();

      return glossary.terms.map((term: Record<string, unknown>) => {
        const id = term.id as string;
        const canonical = term.canonical as string;
        const definition = (term.definition as string) ?? '';
        const aliases = (term.aliases as string[]) ?? [];
        const keywords = (term.keywords as string[]) ?? [];
        const relationships = (term.relationships as string[]) ?? [];
        const status = ((term.status as string) ?? 'active') === 'active' ? 'active' : 'archived';

        const bodyLines = [`# ${canonical}`, '', definition, ''];
        if (aliases.length) bodyLines.push(`Aliases: ${aliases.join(', ')}`);
        if (relationships.length) bodyLines.push(`Related: ${relationships.join(', ')}`);
        if (keywords.length) bodyLines.push(`Keywords: ${keywords.join(', ')}`);

        return {
          id: `domain-${id}`,
          type: 'domain' as const,
          title: canonical,
          summary: definition,
          tags: [...aliases, ...keywords],
          status: status as 'active' | 'archived',
          created: fileDate,
          updated: fileDate,
          related: relationships.map(r => `domain-${r}`),
          source: { kind: 'file' as const, path: 'domain/glossary.json' },
          body: bodyLines.join('\n'),
          ext: {
            tier: term.tier ?? 'core',
            sourceKind: (term.source as Record<string, unknown>)?.kind ?? 'unknown',
          },
          scope: null,
          category: 'domain',
          specCategory: null,
          createdBy: null,
          sourceRef: null,
          parent: null,
        } satisfies WikiEntry;
      });
    } catch {
      return [];
    }
  }

  /**
   * Resolve spec directories for all scopes that exist on disk.
   * Returns entries with scoped ID prefix and source path prefix.
   */
  private resolveSpecScopes(): Array<{
    dir: string;
    scope: WikiScope;
    idPrefix: string;
    sourcePrefix: string;
  }> {
    const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
    const scopes: Array<{
      dir: string;
      scope: WikiScope;
      idPrefix: string;
      sourcePrefix: string;
    }> = [];

    // Global: ~/.maestro/specs/
    const globalDir = join(maestroHome, 'specs');
    if (existsSync(globalDir)) {
      scopes.push({
        dir: globalDir,
        scope: 'global',
        idPrefix: 'spec:global:',
        sourcePrefix: '~/.maestro/specs/',
      });
    }

    // Project baseline: .workflow/specs/
    const projectDir = join(this.workflowRoot, 'specs');
    if (existsSync(projectDir)) {
      scopes.push({
        dir: projectDir,
        scope: 'project',
        idPrefix: 'spec:project:',
        sourcePrefix: 'specs/',
      });
    }

    // Team: .workflow/collab/specs/
    const teamDir = join(this.workflowRoot, 'collab', 'specs');
    if (existsSync(teamDir)) {
      // Only add the team root, not uid subdirs
      scopes.push({
        dir: teamDir,
        scope: 'team',
        idPrefix: 'spec:team:',
        sourcePrefix: 'collab/specs/',
      });
    }

    // Personal: .workflow/collab/specs/{uid}/ — scan each uid subdir
    if (existsSync(teamDir)) {
      try {
        for (const d of readdirSync(teamDir, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const personalDir = join(teamDir, d.name);
          scopes.push({
            dir: personalDir,
            scope: 'personal',
            idPrefix: `spec:personal:${d.name}:`,
            sourcePrefix: `collab/specs/${d.name}/`,
          });
        }
      } catch {
        // Best-effort
      }
    }

    return scopes;
  }

  private async scanVirtual(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];

    // Issues: collect from all JSONL files, then deduplicate by ID keeping the
    // entry with the most recent updated timestamp.  This avoids collision
    // warnings when the same issue ID appears across multiple JSONL sources
    // (e.g. issues.jsonl and review-issues.jsonl).
    const allIssues: WikiEntry[] = [];
    for (const name of await safeReaddir(join(this.workflowRoot, 'issues'))) {
      if (extname(name).toLowerCase() !== '.jsonl') continue;
      const abs = join(this.workflowRoot, 'issues', name);
      if (!this.isInsideRoot(abs)) continue;
      const rel = toForwardSlash(relative(this.workflowRoot, abs));
      allIssues.push(...(await loadVirtualEntries(abs, adaptIssueRow, rel)));
    }
    const issueBest = new Map<string, WikiEntry>();
    for (const e of allIssues) {
      const existing = issueBest.get(e.id);
      if (!existing || e.updated > existing.updated) {
        issueBest.set(e.id, e);
      }
    }
    out.push(...issueBest.values());

    // Codebase: .workflow/codebase/doc-index.json → component/feature/req/ADR
    const codebaseIndex = join(this.workflowRoot, 'codebase', 'doc-index.json');
    if (existsSync(codebaseIndex) && this.isInsideRoot(codebaseIndex)) {
      const rel = toForwardSlash(relative(this.workflowRoot, codebaseIndex));
      out.push(...(await loadVirtualJsonEntries(codebaseIndex, adaptCodebaseDocIndex, rel)));
    }

    // Knowledge Graph: .workflow/codebase/knowledge-graph.json → KG nodes/layers/tour
    // Loaded after doc-index so cross-referencing can link kg-* ↔ codebase-comp-*
    const kgPath = join(this.workflowRoot, 'codebase', 'knowledge-graph.json');
    if (existsSync(kgPath) && this.isInsideRoot(kgPath)) {
      const kgRel = toForwardSlash(relative(this.workflowRoot, kgPath));
      const kgEntries = await loadVirtualJsonEntries(kgPath, adaptKnowledgeGraph, kgRel);
      crossReferenceKgWithDocIndex(kgEntries, out);
      out.push(...kgEntries);
    }

    // Sessions: scan archive.json under scratch/ (sealed) and
    // milestones/{M}/artifacts/ (archived). Adapter filters out active.
    // archive.json carries lifecycle + content_refs; context-package.json
    // is a lazy peek for summary enrichment.
    out.push(...(await this.scanSessionArchives(join(this.workflowRoot, 'scratch'))));
    const milestonesRoot = join(this.workflowRoot, 'milestones');
    if (existsSync(milestonesRoot)) {
      for (const m of await safeReaddir(milestonesRoot)) {
        const artifactsDir = join(milestonesRoot, m, 'artifacts');
        if (!existsSync(artifactsDir)) continue;
        out.push(...(await this.scanSessionArchives(artifactsDir)));
      }
    }

    // CLI sessions: Claude Code (~/.claude/) and Codex (~/.codex/)
    out.push(...(await this.scanCliSessions()));

    return out;
  }

  private async scanCliSessions(): Promise<WikiEntry[]> {
    const projectCwd = dirname(this.workflowRoot);
    const home = homedir();
    const maxAgeDays = 90;
    const maxFiles = 100;

    // Parallel: Claude Code + Codex session loading
    const projectSlug = cwdToClaudeProjectSlug(projectCwd);
    const claudeProjectDir = join(home, '.claude', 'projects', projectSlug);
    const codexRoot = join(home, '.codex');

    const [claudeEntries, codexEntries] = await Promise.all([
      existsSync(claudeProjectDir)
        ? loadClaudeCodeSessions(claudeProjectDir, projectSlug, maxAgeDays, maxFiles).catch(() => [] as WikiEntry[])
        : [] as WikiEntry[],
      existsSync(join(codexRoot, 'sessions'))
        ? loadCodexSessions(codexRoot, projectCwd, maxAgeDays, maxFiles).catch(() => [] as WikiEntry[])
        : [] as WikiEntry[],
    ]);

    return [...claudeEntries, ...codexEntries];
  }

  private async scanSessionArchives(root: string): Promise<WikiEntry[]> {
    if (!existsSync(root)) return [];
    const out: WikiEntry[] = [];
    for (const name of await safeReaddir(root)) {
      const sessionDir = join(root, name);
      const arch = join(sessionDir, 'archive.json');
      if (!existsSync(arch) || !this.isInsideRoot(arch)) continue;
      const rel = toForwardSlash(relative(this.workflowRoot, arch));
      out.push(...(await loadSessionArchiveEntries(arch, rel)));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Linked workspace scanning
  // -------------------------------------------------------------------------

  private async scanLinkedWorkspaces(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];
    for (const lw of this.linkedWorkspaces) {
      if (!existsSync(lw.workflowRoot)) {
        if (process.env.MAESTRO_DEBUG === '1') {
          // eslint-disable-next-line no-console
          console.warn(`[wiki-indexer] linked workspace "${lw.name}" not found: ${lw.workflowRoot}`);
        }
        continue;
      }
      const entries = await this.scanLinkedWorkspace(lw);
      out.push(...entries);
    }
    return out;
  }

  private async scanLinkedWorkspace(lw: {
    name: string;
    workflowRoot: string;
    shareTypes: Set<string>;
  }): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];
    const idPrefix = `ws:${lw.name}:`;

    if (lw.shareTypes.has('spec')) {
      const specsDir = join(lw.workflowRoot, 'specs');
      for (const name of await safeReaddir(specsDir)) {
        if (extname(name).toLowerCase() !== '.md') continue;
        const absPath = join(specsDir, name);
        const entry = await this.parseLinkedFileEntry(absPath, 'spec', lw.name, lw.workflowRoot);
        if (!entry) continue;
        const stem = basename(name, extname(name));
        entry.id = `${idPrefix}spec:${slugify(stem)}`;
        entry.scope = 'linked';
        entry.source = { kind: 'file', path: `specs/${name}`, workspace: lw.name };
        out.push(entry);

        const specEntries = parseSpecEntries(entry.body, name, {
          category: entry.category ?? undefined,
          keywords: entry.tags,
        });
        for (const se of specEntries) {
          out.push({
            id: `${idPrefix}spec:${se.id}`,
            type: 'spec',
            title: se.title,
            summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
            tags: se.keywords,
            status: 'active',
            created: entry.created,
            updated: entry.updated,
            related: [],
            source: { kind: 'file', path: `specs/${name}`, workspace: lw.name },
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp },
            scope: 'linked',
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: entry.sourceRef,
            parent: entry.id,
          });
        }
      }
    }

    if (lw.shareTypes.has('knowhow')) {
      const knowhowDir = join(lw.workflowRoot, 'knowhow');
      const knowhowFiles = await this.scanLinkedKnowhowDir(knowhowDir, lw.name, lw.workflowRoot);
      for (const { entry } of knowhowFiles) {
        if (!entry) continue;
        entry.id = `${idPrefix}${entry.id}`;
        entry.scope = 'linked';
        out.push(entry);
      }
    }

    if (lw.shareTypes.has('domain')) {
      const domainEntries = await this.scanLinkedDomain(lw.workflowRoot, lw.name);
      for (const e of domainEntries) {
        e.id = `${idPrefix}${e.id}`;
        out.push(e);
      }
    }

    if (lw.shareTypes.has('codebase')) {
      const codebaseIndex = join(lw.workflowRoot, 'codebase', 'doc-index.json');
      if (existsSync(codebaseIndex)) {
        const rel = `codebase/doc-index.json`;
        const entries = await loadVirtualJsonEntries(codebaseIndex, adaptCodebaseDocIndex, rel);
        for (const e of entries) {
          e.id = `${idPrefix}${e.id}`;
          e.source = { ...e.source, workspace: lw.name };
          e.scope = 'linked';
          out.push(e);
        }
      }

      const kgPath = join(lw.workflowRoot, 'codebase', 'knowledge-graph.json');
      if (existsSync(kgPath)) {
        const kgRel = `codebase/knowledge-graph.json`;
        const kgEntries = await loadVirtualJsonEntries(kgPath, adaptKnowledgeGraph, kgRel);
        for (const e of kgEntries) {
          e.id = `${idPrefix}${e.id}`;
          e.source = { ...e.source, workspace: lw.name };
          e.scope = 'linked';
          out.push(e);
        }
      }
    }

    return out;
  }

  private async parseLinkedFileEntry(
    absPath: string,
    type: WikiNodeType,
    wsName: string,
    wsWorkflowRoot: string,
  ): Promise<WikiEntry | null> {
    const requested = resolve(absPath);
    const root = resolve(wsWorkflowRoot);
    if (!requested.startsWith(root + sep) && requested !== root) return null;

    try {
      const ls = await lstat(absPath);
      if (ls.isSymbolicLink() || !ls.isFile()) return null;
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
    const summary = asString(data.description) || asString(data.summary) || firstParagraph(content);
    const tags = extractTags(data);
    const status = asStatus(data.status) ?? inferStatus(type);
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);

    const category = asString(data.category) || null;
    const specCategory = asString(data.specCategory) || null;
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = asString(data.sourceRef) || null;
    const parent = asString(data.parent) || null;

    const rel = toForwardSlash(relative(wsWorkflowRoot, absPath));
    const id = `${type}-${slugify(stem)}`;

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
      source: { kind: 'file', path: rel, workspace: wsName },
      body: content,
      ext,
      scope: 'linked',
      category,
      specCategory,
      createdBy,
      sourceRef,
      parent,
    };
  }

  private async scanLinkedKnowhowDir(
    dir: string,
    wsName: string,
    wsWorkflowRoot: string,
  ): Promise<Array<{ entry: WikiEntry | null }>> {
    const results: Array<{ entry: WikiEntry | null }> = [];
    for (const name of await safeReaddir(dir)) {
      const fullPath = join(dir, name);
      let stats: Awaited<ReturnType<typeof stat>> | null = null;
      try { stats = await stat(fullPath); } catch { continue; }

      if (stats.isDirectory()) {
        const nested = await this.scanLinkedKnowhowDir(fullPath, wsName, wsWorkflowRoot);
        results.push(...nested);
      } else if (stats.isFile() && extname(name).toLowerCase() === '.md') {
        const entry = await this.parseLinkedFileEntry(fullPath, 'knowhow', wsName, wsWorkflowRoot);
        if (entry) {
          if (!entry.category) {
            const upper = name.toUpperCase();
            if (upper.startsWith('KNW-')) entry.category = 'session';
            else if (upper.startsWith('TPL-')) entry.category = 'template';
            else if (upper.startsWith('RCP-')) entry.category = 'recipe';
            else if (upper.startsWith('REF-')) entry.category = 'reference';
            else if (upper.startsWith('DCS-')) entry.category = 'decision';
            else if (upper.startsWith('TIP-')) entry.category = 'tip';
            else if (upper.startsWith('AST-')) entry.category = 'asset';
            else if (upper.startsWith('BLP-')) entry.category = 'blueprint';
            else if (upper.startsWith('DOC-')) entry.category = 'document';
          }
        }
        results.push({ entry });
      }
    }
    return results;
  }

  private async scanLinkedDomain(wsWorkflowRoot: string, wsName: string): Promise<WikiEntry[]> {
    const glossaryPath = join(wsWorkflowRoot, 'domain', 'glossary.json');
    try {
      const raw = await readFile(glossaryPath, 'utf-8');
      const glossary = JSON.parse(raw);
      if (!Array.isArray(glossary.terms)) return [];

      let glossaryStat: Awaited<ReturnType<typeof stat>>;
      try { glossaryStat = await stat(glossaryPath); } catch { return []; }
      const fileDate = new Date(glossaryStat.mtimeMs).toISOString();

      return glossary.terms.map((term: Record<string, unknown>) => {
        const id = term.id as string;
        const canonical = term.canonical as string;
        const definition = (term.definition as string) ?? '';
        const aliases = (term.aliases as string[]) ?? [];
        const keywords = (term.keywords as string[]) ?? [];
        const relationships = (term.relationships as string[]) ?? [];
        const status = ((term.status as string) ?? 'active') === 'active' ? 'active' : 'archived';

        const bodyLines = [`# ${canonical}`, '', definition, ''];
        if (aliases.length) bodyLines.push(`Aliases: ${aliases.join(', ')}`);
        if (relationships.length) bodyLines.push(`Related: ${relationships.join(', ')}`);
        if (keywords.length) bodyLines.push(`Keywords: ${keywords.join(', ')}`);

        return {
          id: `domain-${id}`,
          type: 'domain' as const,
          title: canonical,
          summary: definition,
          tags: [...aliases, ...keywords],
          status: status as 'active' | 'archived',
          created: fileDate,
          updated: fileDate,
          related: relationships.map(r => `domain-${r}`),
          source: { kind: 'file' as const, path: 'domain/glossary.json', workspace: wsName },
          body: bodyLines.join('\n'),
          ext: {
            tier: term.tier ?? 'core',
            sourceKind: (term.source as Record<string, unknown>)?.kind ?? 'unknown',
          },
          scope: 'linked' as const,
          category: 'domain',
          specCategory: null,
          createdBy: null,
          sourceRef: null,
          parent: null,
        } satisfies WikiEntry;
      });
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // File parsing
  // -------------------------------------------------------------------------

  private async parseFileEntry(
    absPath: string,
    type: WikiNodeType,
  ): Promise<WikiEntry | null> {
    if (!this.isInsideRoot(absPath)) return null;
    let ls;
    try {
      ls = await lstat(absPath);
      if (ls.isSymbolicLink() || !ls.isFile()) return null;
    } catch {
      return null;
    }

    let raw: string;
    try {
      raw = await readFile(absPath, 'utf-8');
    } catch {
      return null;
    }
    const stats = ls;

    const { data, content } = parseFrontmatter(raw);
    const fileName = basename(absPath);
    const stem = basename(fileName, extname(fileName));

    const title = asString(data.title) || firstHeading(content) || stem;
    const summary = asString(data.description) || asString(data.summary) || firstParagraph(content);
    const tags = extractTags(data);
    const status = asStatus(data.status) ?? inferStatus(type);
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);

    // Enrichment fields from frontmatter
    const category = asString(data.category) || null;
    const specCategory = asString(data.specCategory) || null;
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = asString(data.sourceRef) || null;
    const parent = asString(data.parent) || null;

    const rel = toForwardSlash(relative(this.workflowRoot, absPath));
    // Knowhow files use prefix-<slug>.md naming (KNW-, TIP-, TPL-, etc.).
    // Keep the full stem (including prefix) to avoid collisions when multiple
    // prefixed files share the same timestamp slug (e.g. KNW-20260427-1912 vs
    // DCS-20260427-1912 both slugifying to the same value).
    const id = `${type}-${slugify(stem)}`;

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
      scope: null,
      category,
      specCategory,
      createdBy,
      sourceRef,
      parent,
    };
  }

  private buildBacklinks(
    entries: WikiEntry[],
    byId: Record<string, WikiEntry>,
  ): Record<string, string[]> {
    const blSets = new Map<string, Set<string>>();
    const titleIndex = new Map<string, string>();
    for (const d of entries) titleIndex.set(d.title.toLowerCase(), d.id);

    const push = (target: string, source: string) => {
      const resolved = resolveLink(target, byId, titleIndex);
      if (!resolved) return;
      let s = blSets.get(resolved);
      if (!s) { s = new Set(); blSets.set(resolved, s); }
      s.add(source);
    };

    for (const d of entries) {
      for (const rel of d.related) push(rel, d.id);
      if (d.body) {
        const linkRe = /\[\[([^\]]+)\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(d.body))) push(m[1], d.id);
      }
    }
    const bl: Record<string, string[]> = {};
    for (const [k, v] of blSets) bl[k] = [...v];
    return bl;
  }

  /**
   * Write a lightweight persistent index to `.workflow/wiki-index.json`.
   * Strips body/raw/ext to keep the file small and fast to parse externally.
   * KG virtual entries get additional truncation to prevent file bloat.
   */
  private async persistIndex(index: WikiIndex): Promise<void> {
    const persisted: PersistedWikiIndex = {
      version: 2,
      generatedAt: index.generatedAt,
      entries: index.entries.map((e): PersistedEntry => {
        const isKg = typeof e.ext?.virtualKind === 'string'
          && (e.ext.virtualKind as string).startsWith('kg-');
        return {
          id: e.id,
          type: e.type,
          title: e.title,
          summary: isKg ? e.summary.slice(0, 160) : e.summary,
          tags: isKg ? e.tags.slice(0, 8) : e.tags,
          status: e.status,
          created: e.created,
          updated: e.updated,
          scope: e.scope,
          category: e.category,
          specCategory: e.specCategory,
          createdBy: e.createdBy,
          sourceRef: e.sourceRef,
          parent: e.parent,
          related: isKg ? e.related.slice(0, 8) : e.related,
          source: e.source,
        };
      }),
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
    'category', 'specCategory', 'createdBy', 'sourceRef', 'parent',
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
    if (filters.scope && d.scope !== filters.scope) return false;
    if (filters.tag && !d.tags.includes(filters.tag)) return false;
    if (filters.status && d.status !== filters.status) return false;
    if (filters.category && d.category !== filters.category) return false;
    if (filters.createdBy && d.createdBy !== filters.createdBy) return false;
    if (filters.tool && d.ext?.tool !== true && d.ext?.tool !== 'true') return false;
    if (filters.workspace && d.source.workspace !== filters.workspace) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}
