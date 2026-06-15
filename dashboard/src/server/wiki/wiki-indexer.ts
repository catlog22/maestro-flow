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
} from './virtual-wiki-adapters.js';
import { homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
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
  private mtimeSnapshot: Map<string, number> = new Map();

  constructor(config: WikiIndexerConfig) {
    this.workflowRoot = resolve(config.workflowRoot);
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
    }
    return this.rebuild();
  }

  /**
   * Quick mtime scan of known source directories. If any file's mtime
   * changed since the last rebuild, the cache is stale.
   */
  private async hasSourceChanges(): Promise<boolean> {
    if (this.mtimeSnapshot.size === 0) return true;
    const dirs = [
      join(this.workflowRoot, 'specs'),
      join(this.workflowRoot, 'knowhow'),
      join(this.workflowRoot, 'issues'),
    ];
    const singletons = ['project.md', 'roadmap.md'];
    for (const s of singletons) {
      const p = join(this.workflowRoot, s);
      try {
        const st = await stat(p);
        const prev = this.mtimeSnapshot.get(p);
        if (prev === undefined || st.mtimeMs !== prev) return true;
      } catch {
        if (this.mtimeSnapshot.has(p)) return true;
      }
    }
    for (const dir of dirs) {
      try {
        const st = await stat(dir);
        const prev = this.mtimeSnapshot.get(dir);
        if (prev === undefined || st.mtimeMs !== prev) return true;
      } catch {
        if (this.mtimeSnapshot.has(dir)) return true;
      }
    }
    return false;
  }

  private async captureMtimeSnapshot(): Promise<Map<string, number>> {
    const snap = new Map<string, number>();
    const dirs = [
      join(this.workflowRoot, 'specs'),
      join(this.workflowRoot, 'knowhow'),
      join(this.workflowRoot, 'issues'),
    ];
    const singletons = ['project.md', 'roadmap.md'];
    for (const s of singletons) {
      const p = join(this.workflowRoot, s);
      try { snap.set(p, (await stat(p)).mtimeMs); } catch { /* missing is fine */ }
    }
    for (const dir of dirs) {
      try { snap.set(dir, (await stat(dir)).mtimeMs); } catch { /* missing */ }
    }
    return snap;
  }

  async rebuild(): Promise<WikiIndex> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const fileEntries = await this.scanFiles();
      const virtualEntries = await this.scanVirtual();
      const entries = [...fileEntries, ...virtualEntries];

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
      knowhow: [],
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

  async searchWithScores(query: string, limit = 50): Promise<Array<{ entry: WikiEntry; score: number }>> {
    const index = await this.get();
    const bm25 = await this.getSearchIndex();
    const ranked = searchBM25(bm25, query, limit);
    const out: Array<{ entry: WikiEntry; score: number }> = [];
    for (const r of ranked) {
      const entry = index.byId[r.docId];
      if (entry) out.push({ entry, score: r.score });
    }
    return out;
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
            const refSlug = refStem.replace(/^(KNW|TIP|TPL|RCP|REF|DCS|AST|BLP|DOC)-/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

    // knowhow/*.md  (KNW-→session, TIP-→tip, TPL-→template, RCP-→recipe, REF-→reference, DCS-→decision, DOC-→document)
    for (const name of await safeReaddir(join(this.workflowRoot, 'knowhow'))) {
      if (extname(name).toLowerCase() !== '.md') continue;
      const entry = await this.parseFileEntry(join(this.workflowRoot, 'knowhow', name), 'knowhow');
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
            const refSlug = refStem.replace(/^(KNW|TIP|TPL|RCP|REF|DCS|AST|BLP|DOC)-/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

    return out;
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

    return out;
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
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}
