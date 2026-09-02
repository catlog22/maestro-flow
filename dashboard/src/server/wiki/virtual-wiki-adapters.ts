import { lstatSync } from 'node:fs';
import { readFile, open, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { GraphNode, GraphEdge, Layer, TourStep, KnowledgeGraph } from '../../../../src/graph/types.js';
import type { WikiEntry, WikiStatus } from './wiki-types.js';
import { resolveAllowedDirectSourcePath, resolveAllowedSourcePath } from './source-path.js';

async function readAllowedSourceText(candidate: string, allowedRoot: string): Promise<string> {
  const realPath = resolveAllowedSourcePath(candidate, allowedRoot, 'file');
  if (!realPath) throw new Error(`source escapes allowed root: ${candidate}`);
  return readFile(realPath, 'utf-8');
}

async function readAllowedSourceDir(candidate: string, allowedRoot: string): Promise<string[]> {
  const realPath = resolveAllowedSourcePath(candidate, allowedRoot, 'directory');
  if (!realPath) return [];
  try { return await readdir(realPath); } catch { return []; }
}

/**
 * Lightweight YAML-subset parser for report.md frontmatter handoff fields
 * (verdict/summary/constraints/decisions/concerns). Deliberately does not load
 * the `yaml` package: the built search-ranking adapter certifies its module
 * graph statically, and the yaml CJS entry executes internal require() edges
 * the certifier would flag as undeclared. The dashboard already keeps
 * frontmatter parsing yaml-free (frontmatter-util.ts); this extends that
 * convention to the handoff projection. Supported item shapes mirror
 * report.ts: `- text: <text>` + `status: <status>`, single-line
 * `- <status>: <text>`, and plain `- <text>` strings.
 */
function parseReportFrontmatter(yamlBlock: string): Record<string, unknown> {
  const HANDOFF_STATUS_KEYS = new Set(['proposed', 'accepted', 'rejected', 'locked', 'open', 'deferred']);
  const result: Record<string, unknown> = {};
  let arrayItems: Array<{ text: string; status?: string } | string> | null = null;
  let objectItem: { text: string; status?: string } | null = null;
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');
  const flushObjectItem = () => {
    if (!objectItem) return;
    const text = objectItem.text.trim();
    if (text) arrayItems?.push({ text, status: objectItem.status ?? undefined });
    objectItem = null;
  };

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      flushObjectItem();
      const item = unquote(trimmed.slice(2));
      const colonIdx = item.indexOf(':');
      if (colonIdx !== -1) {
        const itemKey = item.slice(0, colonIdx).trim();
        const itemValue = item.slice(colonIdx + 1);
        if (itemKey === 'text') {
          objectItem = { text: unquote(itemValue) };
        } else if (HANDOFF_STATUS_KEYS.has(itemKey)) {
          objectItem = { text: unquote(itemValue), status: itemKey };
        } else {
          arrayItems?.push(item);
        }
      } else {
        arrayItems?.push(item);
      }
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = unquote(trimmed.slice(colonIdx + 1));
    if (key === 'text' && objectItem) {
      objectItem.text = value;
      continue;
    }
    if (key === 'status' && objectItem) {
      objectItem.status = value;
      continue;
    }
    flushObjectItem();
    if (key === 'constraints' || key === 'decisions' || key === 'concerns') {
      arrayItems = [];
      result[key] = arrayItems;
    } else if (key === 'verdict' || key === 'summary') {
      result[key] = value;
    }
  }
  flushObjectItem();
  return result;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Virtual wiki adapters: read-only reflections of JSONL rows as WikiEntries.
 * Never mutate the source files. Return null on schema violation (logged once
 * per process) so a malformed row cannot break the whole scan.
 */

const warnOnce = new Set<string>();
function warn(key: string, message: string): void {
  if (warnOnce.has(key)) return;
  if (warnOnce.size > 500) warnOnce.clear();
  warnOnce.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[wiki-indexer] ${message}`);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toIso(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function mapIssueStatus(raw: unknown): WikiStatus {
  switch (raw) {
    case 'resolved':
    case 'closed':
      return 'completed';
    case 'deferred':
      return 'archived';
    case 'in_progress':
      return 'active';
    default:
      return 'draft';
  }
}

export function adaptIssueRow(
  row: unknown,
  sourcePath: string,
  line: number,
): WikiEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = asString(r.id);
  if (!id) {
    warn(`issue-no-id:${sourcePath}`, `issue row at ${sourcePath}:${line} missing id`);
    return null;
  }
  const title = asString(r.title) || `Issue ${id}`;
  const description = asString(r.description);
  const issueType = asString(r.type);
  const priority = asString(r.priority);

  const tags: string[] = [];
  if (issueType) tags.push(issueType);
  if (priority) tags.push(priority);

  return {
    id: `issue-${id}`,
    type: 'issue',
    title,
    summary: description.slice(0, 240),
    // Keep the full issue description so `maestro load --type issue` can
    // surface the complete text instead of the 240-char summary.
    body: description,
    tags,
    status: mapIssueStatus(r.status),
    created: toIso(r.created_at),
    updated: toIso(r.updated_at),
    related: [],
    source: { kind: 'virtual', path: sourcePath, line },
    raw: row,
    ext: {
      issueType,
      priority,
      rawStatus: r.status,
      execution: r.execution,
    },
    scope: null,
    category: issueType || null,
    specCategory: null,
    createdBy: null,
    sourceRef: id,
    parent: null,

  };
}

export async function loadVirtualEntries(
  absPath: string,
  adapter: (row: unknown, sourcePath: string, line: number) => WikiEntry | null,
  relPath: string,
): Promise<WikiEntry[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf-8');
  } catch {
    warn(`unreadable:${absPath}`, `cannot read ${absPath}`);
    return [];
  }
  const out: WikiEntry[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warn(`bad-json:${absPath}:${i + 1}`, `invalid JSON at ${absPath}:${i + 1}`);
      continue;
    }
    const entry = adapter(parsed, relPath, i + 1);
    if (entry) out.push(entry);
  }
  return out;
}

export async function loadVirtualJsonEntries(
  absPath: string,
  adapter: (parsed: unknown, sourcePath: string) => WikiEntry[],
  relPath: string,
): Promise<WikiEntry[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf-8');
  } catch {
    warn(`unreadable:${absPath}`, `cannot read ${absPath}`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(`bad-json:${absPath}`, `invalid JSON at ${absPath}`);
    return [];
  }
  try {
    return adapter(parsed, relPath);
  } catch (err) {
    warn(`adapter-fail:${absPath}`, `adapter failed at ${absPath}: ${(err as Error).message}`);
    return [];
  }
}

// ── Knowledge Graph adapter ───────────────────────────────────────────
// Maps .workflow/codebase/knowledge-graph.json → virtual knowhow entries.
// Nodes become searchable wiki entries; edges are stored in ext.kgEdges
// for high-fidelity traversal while related[] feeds standard graph analysis.
// Layers and tour steps get their own entries for macro navigation.

export interface KgAdapterOptions {
  maxRelatedPerNode: number;
  maxSummaryLength: number;
  maxTags: number;
}

const DEFAULT_KG_OPTIONS: KgAdapterOptions = {
  maxRelatedPerNode: 12,
  maxSummaryLength: 240,
  maxTags: 10,
};

const KG_NODE_TYPE_CATEGORY: Record<string, string> = {
  file: 'arch',
  module: 'arch',
  package: 'arch',
  directory: 'arch',
  namespace: 'arch',
  layer: 'arch',
  function: 'coding',
  method: 'coding',
  class: 'coding',
  interface: 'coding',
  type: 'coding',
  enum: 'coding',
  variable: 'coding',
  constant: 'coding',
  component: 'coding',
  hook: 'coding',
  concept: 'arch',
  pattern: 'arch',
  api: 'coding',
  route: 'coding',
  config: 'coding',
};

function kgCategory(nodeType: string): string {
  return KG_NODE_TYPE_CATEGORY[nodeType] ?? 'arch';
}

const NORMALIZED_KG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function stableKgId(raw: string): string {
  if (NORMALIZED_KG_ID.test(raw)) return raw;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function shortStableHash(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 7);
}

function buildKgIdMap(rawIds: Iterable<string>, prefix = 'kg'): Map<string, string> {
  const seen = new Set<string>();
  const normalized: Array<{ raw: string; base: string }> = [];
  const baseCounts = new Map<string, number>();
  for (const raw of rawIds) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const base = stableKgId(raw) || 'node';
    normalized.push({ raw, base });
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const { raw, base } of normalized) {
    const suffix = (baseCounts.get(base) ?? 0) > 1 ? `-${shortStableHash(raw)}` : '';
    result.set(raw, `${prefix}-${base}${suffix}`);
  }
  return result;
}

export function adaptKnowledgeGraph(
  parsed: unknown,
  sourcePath: string,
  opts: KgAdapterOptions = DEFAULT_KG_OPTIONS,
): WikiEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const graph = parsed as Partial<KnowledgeGraph>;
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const layers = graph.layers ?? [];
  const tour = graph.tour ?? [];
  if (nodes.length === 0) return [];
  const idMap = buildKgIdMap(nodes.map(node => node.id));
  const layerIdMap = buildKgIdMap(layers.map(layer => layer.id), 'kg-layer');
  const projectId = (raw: string): string => idMap.get(raw) ?? `kg-${stableKgId(raw) || `node-${shortStableHash(raw)}`}`;

  const ts = toIso(graph.project?.analyzedAt);
  const out: WikiEntry[] = [];

  // Build outgoing edge index: nodeId → edges from that node (limited)
  const outEdges = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const list = outEdges.get(e.source) ?? [];
    list.push(e);
    outEdges.set(e.source, list);
  }

  // Node entries
  for (const n of nodes) {
    if (!n?.id) continue;
    const nodeEdges = outEdges.get(n.id) ?? [];
    const relatedIds = nodeEdges
      .slice(0, opts.maxRelatedPerNode)
      .map(e => projectId(e.target));

    out.push({
      id: projectId(n.id),
      type: 'knowhow',
      title: n.name || n.id,
      summary: (n.summary || '').slice(0, opts.maxSummaryLength),
      tags: ['kg', `kg:${n.type}`, ...(n.tags ?? []).slice(0, opts.maxTags)],
      status: 'active',
      created: ts,
      updated: ts,
      related: relatedIds,
      source: { kind: 'virtual', path: sourcePath },
      body: '',
      raw: n,
      ext: {
        virtualKind: 'kg-node',
        kgNodeId: n.id,
        nodeType: n.type,
        filePath: n.filePath ?? null,
        complexity: n.complexity ?? null,
        kgEdges: nodeEdges.map(e => ({
          target: projectId(e.target),
          type: e.type,
          weight: e.weight ?? 1,
          direction: e.direction,
        })),
      },
      scope: null,
      category: kgCategory(n.type),
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: n.id,
      parent: null,
    });
  }

  // Layer entries
  for (const l of layers) {
    if (!l?.id) continue;
    out.push({
      id: layerIdMap.get(l.id)!,
      type: 'knowhow',
      title: l.name || l.id,
      summary: (l.description || '').slice(0, opts.maxSummaryLength),
      // Legacy JSONL layers carry a description — preserve it as body so
      // load/search can surface the full text (DB adapter already does).
      body: l.description ?? '',
      tags: ['kg', 'kg:layer'],
      status: 'active',
      created: ts,
      updated: ts,
      related: (l.nodeIds ?? []).slice(0, opts.maxRelatedPerNode).map(projectId),
      source: { kind: 'virtual', path: sourcePath },
      raw: l,
      ext: { virtualKind: 'kg-layer', kgLayerId: l.id },
      scope: null,
      category: 'arch',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: l.id,
      parent: null,
    });
  }

  // Tour step entries (chained via parent)
  let prevTourId: string | null = null;
  for (const step of tour) {
    if (!step?.title) continue;
    const stepId = `kg-tour-${step.order}`;
    out.push({
      id: stepId,
      type: 'knowhow',
      title: `Tour ${step.order}: ${step.title}`,
      summary: (step.description || '').slice(0, opts.maxSummaryLength),
      body: step.description ?? '',
      tags: ['kg', 'kg:tour'],
      status: 'active',
      created: ts,
      updated: ts,
      related: (step.nodeIds ?? []).slice(0, opts.maxRelatedPerNode).map(projectId),
      source: { kind: 'virtual', path: sourcePath },
      raw: step,
      ext: { virtualKind: 'kg-tour-step', order: step.order, languageLesson: step.languageLesson ?? null },
      scope: null,
      category: 'arch',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: `tour-step-${step.order}`,
      parent: prevTourId,
    });
    prevTourId = stepId;
  }

  return out;
}

interface MaestroGraphWikiRow {
  id: string;
  kind: string;
  name: string;
  file_path: string | null;
  source_type: string;
  definition: string | null;
  body: string | null;
  category: string | null;
  updated_at: number;
}

/** Read-only Wiki projection of the canonical MaestroGraph SQLite database. */
export function adaptKnowledgeGraphFromDb(
  dbPath: string,
  sourcePath: string,
  opts: KgAdapterOptions = DEFAULT_KG_OPTIONS,
): WikiEntry[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // Preserve the canonical non-codegraph-first ordering without sorting an
    // expression across the entire node table. Both branches can use existing
    // source/name indexes and together are exactly equivalent to the prior
    // `source_type != 'codegraph' DESC, name` ordering.
    const knowledgeNodes = db.prepare(`
      SELECT id, kind, name, file_path, source_type, definition, body, category, updated_at
      FROM nodes
      WHERE source_type != 'codegraph'
      ORDER BY name
      LIMIT 5000
    `).all() as unknown as MaestroGraphWikiRow[];
    const remaining = 5000 - knowledgeNodes.length;
    const codeNodes = remaining > 0
      ? db.prepare(`
          SELECT id, kind, name, file_path, source_type, definition, body, category, updated_at
          FROM nodes
          WHERE source_type = 'codegraph'
          ORDER BY name
          LIMIT ?
        `).all(remaining) as unknown as MaestroGraphWikiRow[]
      : [];
    const nodes = [...knowledgeNodes, ...codeNodes];
    if (nodes.length === 0) return [];

    const idMap = buildKgIdMap(nodes.map(node => node.id));
    // Pass the already selected IDs into SQLite instead of repeating the
    // ordered 5,000-node projection in an edge CTE. json_each keeps this a
    // single bounded parameter and both joins retain the previous membership.
    const projectedEdges = db.prepare(`
      WITH selected(id) AS (SELECT value FROM json_each(?))
      SELECT e.source, e.target, e.kind
      FROM edges e
      JOIN selected source_node ON source_node.id = e.source
      JOIN selected target_node ON target_node.id = e.target
      LIMIT 20000
    `).all(JSON.stringify([...idMap.keys()])) as unknown as Array<{ source: string; target: string; kind: string }>;
    const outgoing = new Map<string, Array<{ target: string; kind: string }>>();
    for (const edge of projectedEdges) {
      const list = outgoing.get(edge.source) ?? [];
      list.push({ target: edge.target, kind: edge.kind });
      outgoing.set(edge.source, list);
    }

    return nodes.map(node => {
      const nodeEdges = outgoing.get(node.id) ?? [];
      const updated = node.updated_at > 0 ? new Date(node.updated_at).toISOString() : '';
      const summary = (node.definition || node.body || `${node.kind} in ${node.file_path ?? 'MaestroGraph'}`)
        .slice(0, opts.maxSummaryLength);
      return {
        id: idMap.get(node.id)!,
        type: 'knowhow' as const,
        title: node.name,
        summary,
        // Keep the full node body so `maestro load` can surface the complete
        // text (spec/knowhow nodes carry it; codegraph nodes have NULL body
        // and fall back to the empty string — load then shows a filePath hint).
        body: node.body ?? '',
        tags: ['kg', `kg:${node.kind}`, `source:${node.source_type}`].slice(0, opts.maxTags),
        status: 'active' as const,
        created: updated,
        updated,
        related: nodeEdges.slice(0, opts.maxRelatedPerNode).map(edge => idMap.get(edge.target)!),
        source: { kind: 'virtual' as const, path: sourcePath },
        raw: node,
        ext: {
          virtualKind: 'kg-node',
          kgNodeId: node.id,
          nodeType: node.kind,
          filePath: node.file_path,
          kgEdges: nodeEdges.map(edge => ({
            target: idMap.get(edge.target)!,
            type: edge.kind,
            weight: 1,
          })),
        },
        scope: null,
        category: node.category || kgCategory(node.kind),
        specCategory: node.source_type === 'spec' ? node.category : null,
        createdBy: 'maestrograph-db',
        sourceRef: node.id,
        parent: null,
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Cross-reference KG entries with existing codebase doc-index entries.
 * Matches by filePath → code_locations. Mutates kgEntries in place.
 */
export function crossReferenceKgWithDocIndex(
  kgEntries: WikiEntry[],
  docIndexEntries: WikiEntry[],
): void {
  const compByPath = new Map<string, string>();
  for (const e of docIndexEntries) {
    if (e.ext.virtualKind !== 'codebase-component') continue;
    for (const loc of (e.ext.codeLocations ?? []) as string[]) {
      compByPath.set(loc.replace(/\\/g, '/').toLowerCase(), e.id);
    }
  }

  for (const kg of kgEntries) {
    if (kg.ext.virtualKind !== 'kg-node') continue;
    const fp = kg.ext.filePath as string | null;
    if (!fp) continue;
    const peer = compByPath.get(fp.replace(/\\/g, '/').toLowerCase());
    if (peer) {
      if (!kg.related.includes(peer)) kg.related.push(peer);
      kg.ext.semanticDuplicateOf = peer;
    }
  }
}

// ── Codebase doc-index adapter ──────────────────────────────────────────
// Maps .workflow/codebase/doc-index.json → virtual knowhow entries with
// source.path pointing to the per-component / per-feature markdown so
// `wiki load` opens the actual generated doc.

interface CodebaseComponent {
  id: string;
  name: string;
  type?: string;
  code_locations?: string[];
  feature_ids?: string[];
  symbols?: string[];
  last_updated?: string;
}

interface CodebaseFeature {
  id: string;
  name: string;
  status?: string;
  requirement_ids?: string[];
  component_ids?: string[];
  phase?: string | null;
}

interface CodebaseRequirement {
  id: string;
  title: string;
  priority?: string;
  feature_id?: string;
  status?: string;
  acceptance_criteria?: string[];
}

interface CodebaseAdr {
  id: string;
  title: string;
  component_ids?: string[];
  decision?: string;
  rationale?: string;
}

interface CodebaseDocIndex {
  project?: string;
  last_updated?: string;
  features?: CodebaseFeature[];
  components?: CodebaseComponent[];
  requirements?: CodebaseRequirement[];
  architecture_decisions?: CodebaseAdr[];
}

function mapCodebaseStatus(raw: string | undefined): WikiStatus {
  switch (raw) {
    case 'active': return 'active';
    case 'completed': return 'completed';
    case 'pending':
    case 'in_progress':
      return 'draft';
    case 'archived': return 'archived';
    default: return 'active';
  }
}

export function adaptCodebaseDocIndex(parsed: unknown, sourcePath: string): WikiEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const idx = parsed as CodebaseDocIndex;
  const out: WikiEntry[] = [];
  const ts = toIso(idx.last_updated);

  for (const c of idx.components ?? []) {
    if (!c?.id) continue;
    const slug = slugify(c.name || c.id);
    const featureIds = c.feature_ids ?? [];
    out.push({
      id: `codebase-comp-${c.id.toLowerCase()}`,
      type: 'knowhow',
      title: c.name || c.id,
      summary: (c.symbols ?? []).slice(0, 5).join(', ') || `${c.type ?? 'component'} at ${(c.code_locations ?? []).slice(0, 1).join('') || '?'}`,
      tags: [c.type ?? 'component', ...featureIds].filter(Boolean) as string[],
      status: 'active',
      created: ts,
      updated: toIso(c.last_updated ?? idx.last_updated),
      related: featureIds.map(f => `codebase-feat-${f.toLowerCase()}`),
      source: { kind: 'virtual', path: `codebase/tech-registry/${slug}.md` },
      body: '',
      raw: c,
      ext: { virtualKind: 'codebase-component', codeLocations: c.code_locations, symbols: c.symbols, docIndexPath: sourcePath },
      scope: null,
      category: 'arch',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: c.id,
      parent: null,
    });
  }

  for (const f of idx.features ?? []) {
    if (!f?.id) continue;
    const slug = slugify(f.name || f.id);
    const compIds = f.component_ids ?? [];
    const reqIds = f.requirement_ids ?? [];
    out.push({
      id: `codebase-feat-${f.id.toLowerCase()}`,
      type: 'knowhow',
      title: f.name || f.id,
      summary: `${compIds.length} components, ${reqIds.length} requirements${f.phase ? `, phase ${f.phase}` : ''}`,
      tags: ['feature', ...(f.status ? [f.status] : [])],
      status: mapCodebaseStatus(f.status),
      created: ts,
      updated: ts,
      related: [
        ...compIds.map(id => `codebase-comp-${id.toLowerCase()}`),
        ...reqIds.map(id => `codebase-req-${id.toLowerCase()}`),
      ],
      source: { kind: 'virtual', path: `codebase/feature-maps/${slug}.md` },
      body: '',
      raw: f,
      ext: { virtualKind: 'codebase-feature', phase: f.phase, docIndexPath: sourcePath },
      scope: null,
      category: 'arch',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: f.id,
      parent: null,
    });
  }

  for (const r of idx.requirements ?? []) {
    if (!r?.id) continue;
    out.push({
      id: `codebase-req-${r.id.toLowerCase()}`,
      type: 'knowhow',
      title: r.title || r.id,
      summary: (r.acceptance_criteria ?? []).slice(0, 1).join('') || `${r.priority ?? ''} requirement`.trim(),
      body: (r.acceptance_criteria ?? []).join('\n'),
      tags: ['requirement', ...(r.priority ? [r.priority] : []), ...(r.status ? [r.status] : [])],
      status: mapCodebaseStatus(r.status),
      created: ts,
      updated: ts,
      related: r.feature_id ? [`codebase-feat-${r.feature_id.toLowerCase()}`] : [],
      source: { kind: 'virtual', path: sourcePath },
      raw: r,
      ext: { virtualKind: 'codebase-requirement', priority: r.priority, acceptanceCriteria: r.acceptance_criteria },
      scope: null,
      category: 'review',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: r.id,
      parent: r.feature_id ? `codebase-feat-${r.feature_id.toLowerCase()}` : null,
    });
  }

  for (const a of idx.architecture_decisions ?? []) {
    if (!a?.id) continue;
    const compIds = a.component_ids ?? [];
    out.push({
      id: `codebase-adr-${a.id.toLowerCase()}`,
      type: 'knowhow',
      title: a.title || a.id,
      summary: (a.decision ?? '').slice(0, 240),
      // Compose the full ADR text from decision + rationale.
      body: [a.decision, a.rationale].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n'),
      tags: ['adr', ...compIds],
      status: 'completed',
      created: ts,
      updated: ts,
      related: compIds.map(id => `codebase-comp-${id.toLowerCase()}`),
      source: { kind: 'virtual', path: sourcePath },
      raw: a,
      ext: { virtualKind: 'codebase-adr', rationale: a.rationale },
      scope: null,
      category: 'arch',
      specCategory: null,
      createdBy: 'manage-codebase-rebuild',
      sourceRef: a.id,
      parent: null,
    });
  }

  return out;
}

// ── Session / Run adapters (run-mode lifecycle) ─────────────────────────

const RUN_COMMAND_CATEGORY: Record<string, string> = {
  grill: 'arch',
  'maestro-grill': 'arch',
  collab: 'arch',
  'maestro-collab': 'arch',
  brainstorm: 'arch',
  'maestro-brainstorm': 'arch',
  blueprint: 'arch',
  'maestro-blueprint': 'arch',
  roadmap: 'arch',
  'maestro-roadmap': 'arch',
  analyze: 'arch',
  'maestro-analyze': 'arch',
  plan: 'coding',
  'maestro-plan': 'coding',
  execute: 'coding',
  'maestro-execute': 'coding',
  verify: 'review',
  review: 'review',
  'quality-review': 'review',
  test: 'test',
  'quality-test': 'test',
  'auto-test': 'test',
  'quality-auto-test': 'test',
  debug: 'debug',
  'quality-debug': 'debug',
  retrospective: 'learning',
  'quality-retrospective': 'learning',
};

interface RunModeSession {
  schema_version?: 'session/1.3';
  source_schema_version?: string;
  session_id?: string;
  intent?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  lifecycle?: {
    sealed_at?: string | null;
    seal_summary?: string | null;
    /** Read-model promotion refs. */
    promoted?: string[];
    /** Canonical SessionStore promotion fields. */
    promoted_spec_ids?: string[];
    promoted_knowhow_ids?: string[];
  };
}

interface RunModeArtifact {
  kind?: string;
  role?: string;
  run_id?: string;
  path?: string;
  status?: string;
}

interface RunModeRegistry {
  schema_version?: 'artifacts/1.1';
  artifacts?: Record<string, RunModeArtifact>;
  aliases?: Record<string, string>;
}

interface RunModeHandoffItem {
  text?: string;
  status?: string;
}

interface RunModeGate {
  title?: string;
  status?: string;
  waiver?: string | null;
}

interface RunModeRun {
  schema_version?: 'run/1.1';
  source_schema_version?: string;
  run_id?: string;
  command?: string;
  status?: string;
  primary?: string | null;
  gates?: RunModeGate[];
  handoff?: {
    verdict?: string;
    summary?: string;
    constraints?: RunModeHandoffItem[];
    decisions?: RunModeHandoffItem[];
    concerns?: string[];
    artifact_refs?: string[];
  } | null;
  started_at?: string;
  ended_at?: string | null;
}

function isIndexedSessionLifecycle(session: RunModeSession): boolean {
  return session.source_schema_version === 'session/3.0'
    ? session.status === 'completed' || session.status === 'archived' || session.status === 'failed'
    : session.status === 'sealed' || session.status === 'archived';
}

function isIndexedRunLifecycle(run: RunModeRun): boolean {
  return run.source_schema_version === 'run/3.0'
    ? run.status === 'sealed'
    : run.status === 'sealed' || run.status === 'archived';
}

function sessionWikiStatus(session: RunModeSession): WikiStatus {
  if (session.status === 'archived') return 'archived';
  if (session.status === 'failed') return 'blocked';
  return 'completed';
}

function runWikiStatus(run: RunModeRun): WikiStatus {
  if (run.status === 'archived') return 'archived';
  if (run.handoff?.verdict === 'blocked' || run.handoff?.verdict === 'needs_retry') return 'blocked';
  return 'completed';
}

function extractArtifactSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  for (const key of ['summary', 'verdict', 'conclusion', 'title', 'description']) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 500);
  }
  return '';
}

function extractReportSummary(raw: string): string {
  const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const summary = frontmatter?.[1].match(/^summary:\s*(.+)$/m)?.[1]?.trim();
  if (summary) return summary.replace(/^['"]|['"]$/g, '').slice(0, 500);
  const section = raw.match(/^##\s+(?:摘要|Summary)\s*\r?\n+([^#][\s\S]*?)(?=\r?\n##\s|$)/mi)?.[1];
  return section?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
}

function reportHandoff(raw: string): RunModeRun['handoff'] {
  const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const parsed = parseReportFrontmatter(frontmatter[1]);
  if (!parsed || typeof parsed !== 'object') return null;
  const items = (key: 'constraints' | 'decisions'): RunModeHandoffItem[] => {
    const value = parsed[key];
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
      if (typeof item === 'string') return item ? [{ text: item }] : [];
      return [{ text: item.text, status: item.status }];
    });
  };
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict : undefined,
    summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    constraints: items('constraints'),
    decisions: items('decisions'),
    concerns,
    artifact_refs: [],
  };
}

function reportMarkdownBody(raw: string): string {
  return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, '').trim().slice(0, 50_000);
}

function runDirectorySequence(name: string): number {
  const match = name.match(/^\d{8}-(\d{3})-/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function compareRunDirectories(left: string, right: string): number {
  return runDirectorySequence(left) - runDirectorySequence(right) || left.localeCompare(right);
}

function structuredHandoffBody(run: RunModeRun): { body: string; firstDecision: string; hasLockedConstraints: boolean } {
  const acceptedDecisions = (run.handoff?.decisions ?? [])
    .filter(item => item.status === 'accepted' && item.text?.trim())
    .map(item => item.text!.trim());
  const lockedConstraints = (run.handoff?.constraints ?? [])
    .filter(item => item.status === 'locked' && item.text?.trim())
    .map(item => item.text!.trim());
  const concerns = (run.handoff?.concerns ?? []).map(item => item.trim()).filter(Boolean);
  const waivers = (run.gates ?? [])
    .filter(gate => gate.status === 'waived' && gate.waiver?.trim())
    .map(gate => gate.title?.trim() ? `${gate.title!.trim()}：${gate.waiver!.trim()}` : gate.waiver!.trim());
  const sections: string[] = [];
  if (acceptedDecisions.length > 0) sections.push(`## 决策\n${acceptedDecisions.map(item => `- ${item}`).join('\n')}`);
  if (lockedConstraints.length > 0) sections.push(`## 约束\n${lockedConstraints.map(item => `- ${item}`).join('\n')}`);
  if (concerns.length > 0) sections.push(`## 关注点\n${concerns.map(item => `- ${item}`).join('\n')}`);
  if (waivers.length > 0) sections.push(`## 豁免\n${waivers.map(item => `- ${item}`).join('\n')}`);
  return {
    body: sections.join('\n\n'),
    firstDecision: acceptedDecisions[0] ?? '',
    hasLockedConstraints: lockedConstraints.length > 0,
  };
}

function resolveArefArtifact(source: string, registry: RunModeRegistry): string | null {
  const artifactId = registry.aliases?.[source] ?? source;
  return registry.artifacts?.[artifactId]?.status === 'sealed' ? artifactId : null;
}

function extractArefArtifactIds(report: string, registry: RunModeRegistry): string[] {
  const sources: string[] = [];
  for (const match of report.matchAll(/\{\{aref:([^}#\s]+)(?:#[^}]*)?\}\}/g)) sources.push(match[1]);
  for (const match of report.matchAll(/```aref\s*\r?\n([\s\S]*?)```/gi)) {
    const source = match[1].match(/^\s*source:\s*["']?([^"'\s#]+)["']?\s*$/m)?.[1];
    if (source) sources.push(source);
  }
  return [...new Set(sources.map(source => resolveArefArtifact(source, registry)).filter((id): id is string => Boolean(id)))];
}

async function readRunKnowledge(
  sessionDir: string,
  runDir: string,
  run: RunModeRun,
  registry: RunModeRegistry,
  allowedRoot: string,
): Promise<{
  summary: string;
  body: string;
  artifactIds: string[];
  kinds: string[];
  arefArtifactIds: string[];
  hasLockedConstraints: boolean;
}> {
  const artifactEntries = Object.entries(registry.artifacts ?? {})
    .filter(([, artifact]) => artifact.run_id === run.run_id && artifact.status === 'sealed')
    .sort(([leftId], [rightId]) => Number(rightId === run.primary) - Number(leftId === run.primary));
  const uniqueIds = artifactEntries.map(([id]) => id);
  const kinds = [...new Set(artifactEntries.map(([, artifact]) => artifact.kind?.trim() ?? '').filter(Boolean))];
  const bodies: string[] = [];
  let summary = '';

  for (const [, artifact] of artifactEntries) {
    if (!artifact.path || artifact.role === 'report') continue;
    const absPath = resolve(sessionDir, artifact.path);
    if (!absPath.startsWith(`${resolve(sessionDir)}${sep}`)) continue;
    try {
      const raw = await readAllowedSourceText(absPath, allowedRoot);
      bodies.push(raw.slice(0, 50_000));
      if (!summary && artifact.path.toLowerCase().endsWith('.json')) {
        try { summary = extractArtifactSummary(JSON.parse(raw)); } catch { /* malformed artifact is ignored */ }
      }
    } catch { /* registry may contain a stale optional attachment */ }
  }

  let report = '';
  try { report = await readAllowedSourceText(join(runDir, 'report.md'), allowedRoot); } catch { /* projection is optional */ }
  if (!summary) {
    summary = extractReportSummary(report);
  }
  if (!summary) summary = run.handoff?.summary?.trim().slice(0, 500) ?? '';
  const projectedRun = run.source_schema_version === 'run/3.0'
    ? { ...run, handoff: reportHandoff(report) ?? run.handoff }
    : run;
  if (run.source_schema_version === 'run/3.0') {
    const markdownBody = reportMarkdownBody(report);
    if (markdownBody) bodies.unshift(markdownBody);
  }
  const structured = structuredHandoffBody(projectedRun);
  if (structured.firstDecision && !summary.includes(structured.firstDecision)) {
    summary = [summary, `决策：${structured.firstDecision}`].filter(Boolean).join('；').slice(0, 500);
  }
  return {
    summary,
    body: [structured.body, ...bodies].filter(Boolean).join('\n\n'),
    artifactIds: uniqueIds,
    kinds,
    arefArtifactIds: extractArefArtifactIds(report, registry),
    hasLockedConstraints: structured.hasLockedConstraints,
  };
}

// ── Session/Run persistence normalization ───────────────────────────────
// Runtime writes session/3.0 + run/3.0 while retaining compatible legacy
// readers for session/1.0-1.3 and command-run/1.0-1.3. Mirror that boundary
// here without importing runtime code into the dashboard production bundle.
// Unknown versions stay fail-closed.

interface LegacyRunModeGate {
  id?: string;
  title?: string;
  run_id?: string | null;
  status?: string;
  waiver?: { reason?: string; approved_by?: string; approved_at?: string } | null;
}

function normalizeRunModeSession(raw: Record<string, unknown>): RunModeSession | null {
  if (raw.schema_version === 'session/3.0') {
    return {
      schema_version: 'session/1.3',
      source_schema_version: 'session/3.0',
      session_id: asString(raw.session_id),
      intent: asString(raw.objective),
      status: asString(raw.status),
      created_at: asString(raw.created_at),
      updated_at: asString(raw.archived_at) || asString(raw.completed_at) || asString(raw.updated_at),
      lifecycle: {
        sealed_at: asString(raw.archived_at) || asString(raw.completed_at) || asString(raw.updated_at) || null,
        seal_summary: null,
        promoted: [],
      },
    };
  }
  if (
    raw.schema_version !== 'session/1.0'
    && raw.schema_version !== 'session/1.1'
    && raw.schema_version !== 'session/1.2'
    && raw.schema_version !== 'session/1.3'
  ) return null;
  const session = raw as RunModeSession;
  const lifecycle = session.lifecycle;
  const promoted = [
    ...(lifecycle?.promoted ?? []),
    ...(lifecycle?.promoted_spec_ids ?? []).map(id => `spec:${id}`),
    ...(lifecycle?.promoted_knowhow_ids ?? []).map(id => `knowhow:${id}`),
  ];
  return {
    schema_version: 'session/1.3',
    source_schema_version: asString(raw.schema_version),
    session_id: session.session_id,
    intent: session.intent,
    status: session.status,
    lifecycle: {
      sealed_at: lifecycle?.sealed_at ?? null,
      seal_summary: lifecycle?.seal_summary ?? null,
      promoted: [...new Set(promoted)],
    },
  };
}

function normalizeRunModeRegistry(raw: Record<string, unknown>): RunModeRegistry | null {
  if (raw.schema_version === 'artifacts/1.1') return raw as RunModeRegistry;
  if (raw.schema_version !== 'artifacts/1.0') return null;
  const legacy = raw as {
    artifacts?: Record<string, RunModeArtifact & { producer_run_id?: string; relative_path?: string }>;
    aliases?: Record<string, string>;
  };
  const artifacts: Record<string, RunModeArtifact> = {};
  for (const [id, artifact] of Object.entries(legacy.artifacts ?? {})) {
    artifacts[id] = {
      kind: artifact.kind,
      role: artifact.role,
      run_id: artifact.producer_run_id,
      path: artifact.relative_path,
      status: artifact.status,
    };
  }
  return { schema_version: 'artifacts/1.1', artifacts, aliases: legacy.aliases ?? {} };
}

function legacyWaiverText(waiver: NonNullable<LegacyRunModeGate['waiver']>): string {
  const reason = waiver.reason?.trim() ?? '';
  if (!waiver.approved_by) return reason;
  return `${reason} (${waiver.approved_by} @ ${waiver.approved_at ?? '?'})`;
}

interface PersistedRunModeRun {
  run_id?: string;
  command?: { name?: string };
  status?: string;
  gate_ids?: string[];
  output?: { primary_artifact_id?: string | null };
  handoff?: RunModeRun['handoff'];
  started_at?: string;
  completed_at?: string | null;
  sealed_at?: string | null;
}

function normalizeRunModeRun(raw: Record<string, unknown>, legacyGates: LegacyRunModeGate[]): RunModeRun | null {
  if (raw.schema_version === 'run/3.0') {
    const outputRefs = Array.isArray(raw.output_refs)
      ? raw.output_refs.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      schema_version: 'run/1.1',
      source_schema_version: 'run/3.0',
      run_id: asString(raw.run_id),
      command: asString(raw.command),
      status: asString(raw.status),
      primary: asString(raw.primary_artifact_id) || null,
      gates: [],
      handoff: {
        verdict: asString(raw.verdict),
        summary: asString(raw.summary),
        constraints: [],
        decisions: [],
        concerns: [],
        artifact_refs: outputRefs,
      },
      started_at: asString(raw.started_at) || asString(raw.created_at),
      ended_at: asString(raw.sealed_at) || asString(raw.ended_at) || null,
    };
  }
  if (raw.schema_version === 'run/1.1') return raw as RunModeRun;
  if (
    raw.schema_version !== 'command-run/1.0'
    && raw.schema_version !== 'command-run/1.1'
    && raw.schema_version !== 'command-run/1.2'
    && raw.schema_version !== 'command-run/1.3'
  ) return null;
  const persisted = raw as PersistedRunModeRun;
  const runId = persisted.run_id;
  const gateIds = new Set(persisted.gate_ids ?? []);
  return {
    schema_version: 'run/1.1',
    source_schema_version: asString(raw.schema_version),
    run_id: runId,
    command: persisted.command?.name,
    status: persisted.status,
    primary: persisted.output?.primary_artifact_id ?? null,
    gates: legacyGates
      .filter(gate => gateIds.size > 0 ? gateIds.has(gate.id ?? '') : gate.run_id === runId)
      .map(gate => ({
        title: gate.title,
        status: gate.status,
        waiver: gate.waiver ? legacyWaiverText(gate.waiver) : null,
      })),
    handoff: persisted.handoff ?? null,
    started_at: persisted.started_at,
    ended_at: persisted.sealed_at ?? persisted.completed_at ?? null,
  };
}

/** command-run generations keep canonical gate details in session-level gates.json. */
async function readLegacySessionGates(
  sessionDir: string,
  allowedRoot: string,
): Promise<LegacyRunModeGate[]> {
  try {
    const registry = JSON.parse(await readAllowedSourceText(join(sessionDir, 'gates.json'), allowedRoot)) as {
      gates?: Record<string, LegacyRunModeGate>;
    };
    return Object.entries(registry.gates ?? {}).map(([id, gate]) => ({ ...gate, id }));
  } catch { return []; }
}

async function readPromotedKnowledgeRefs(
  sessionDir: string,
  runNames: string[],
  allowedRoot: string,
): Promise<string[]> {
  const paths = [
    join(sessionDir, 'knowledge-delta.json'),
    ...runNames.map(runName => join(sessionDir, 'runs', runName, 'knowledge-delta.json')),
  ];
  const refs: string[] = [];
  for (const path of paths) {
    try {
      const delta = JSON.parse(await readAllowedSourceText(path, allowedRoot)) as {
        candidates?: Array<{ status?: string; target?: string; promoted_id?: string | null }>;
      };
      for (const candidate of delta.candidates ?? []) {
        if (candidate.status !== 'promoted' || !candidate.promoted_id) continue;
        if (candidate.target === 'spec' || candidate.target === 'knowhow') {
          refs.push(`${candidate.target}:${candidate.promoted_id}`);
        }
      }
    } catch { /* missing or malformed optional knowledge projection */ }
  }
  return [...new Set(refs)];
}

/** Load a run-mode session and its sealed runs without indexing draft projections. */
export async function loadRunModeSessionEntries(
  sessionAbsPath: string,
  sessionRelPath: string,
  allowedRoot = dirname(sessionAbsPath),
): Promise<WikiEntry[]> {
  const realSessionPath = resolveAllowedSourcePath(sessionAbsPath, allowedRoot, 'file');
  if (!realSessionPath) return [];
  let session: RunModeSession | null;
  try { session = normalizeRunModeSession(JSON.parse(await readAllowedSourceText(realSessionPath, allowedRoot))); } catch { return []; }
  if (!session) {
    if (process.env.MAESTRO_DEBUG === '1') {
      warn(`run-session-schema:${sessionAbsPath}`, `unsupported run-mode session schema at ${sessionAbsPath}`);
    }
    return [];
  }
  if (!isIndexedSessionLifecycle(session)) return [];

  const sessionDir = dirname(realSessionPath);
  const sessionId = session.session_id ?? basename(sessionDir);
  const sessionSlug = slugify(sessionId);
  if (!sessionSlug) return [];

  let registry: RunModeRegistry | null = null;
  try { registry = normalizeRunModeRegistry(JSON.parse(await readAllowedSourceText(join(sessionDir, 'artifacts.json'), allowedRoot))); } catch { /* missing registry → unsupported */ }
  if (!registry) {
    if (process.env.MAESTRO_DEBUG === '1') {
      warn(`run-artifacts-schema:${sessionDir}`, `unsupported run-mode artifact registry schema at ${sessionDir}`);
    }
    return [];
  }

  const legacyGates = await readLegacySessionGates(sessionDir, allowedRoot);
  const runEntries: WikiEntry[] = [];
  const runsRoot = join(sessionDir, 'runs');
  const runNames = (await readAllowedSourceDir(runsRoot, allowedRoot)).sort(compareRunDirectories);
  for (const runName of runNames) {
    const runDir = join(runsRoot, runName);
    let run: RunModeRun | null;
    try { run = normalizeRunModeRun(JSON.parse(await readAllowedSourceText(join(runDir, 'run.json'), allowedRoot)), legacyGates); } catch { continue; }
    if (!run) {
      if (process.env.MAESTRO_DEBUG === '1') {
        warn(`run-schema:${runDir}`, `unsupported run schema at ${runDir}`);
      }
      continue;
    }
    if (!isIndexedRunLifecycle(run)) continue;
    const runId = run.run_id ?? runName;
    const command = run.command?.trim() || 'run';
    const knowledge = await readRunKnowledge(sessionDir, runDir, run, registry, allowedRoot);
    const runRel = `${sessionRelPath.replace(/\/session\.json$/, '')}/runs/${runName}/run.json`;
    const verdictTag = run.handoff?.verdict ? [`verdict:${run.handoff.verdict}`] : [];
    const constraintTag = knowledge.hasLockedConstraints ? ['constraint'] : [];
    const gateTags = [...new Set((run.gates ?? []).map(gate => gate.status?.trim()).filter(Boolean))]
      .map(status => `gate:${status}`);
    const arefRunEntries = [...new Set(knowledge.arefArtifactIds
      .map(id => registry.artifacts?.[id]?.run_id)
      .filter((producerRunId): producerRunId is string => Boolean(producerRunId) && producerRunId !== runId)
      .map(producerRunId => `session-run-${sessionSlug}-${slugify(producerRunId)}`))];
    runEntries.push({
      id: `session-run-${sessionSlug}-${slugify(runId)}`,
      type: 'knowhow',
      title: `${command} ${runId}`,
      summary: knowledge.summary,
      tags: ['session', 'run', run.status!, command, ...verdictTag, ...constraintTag, ...gateTags, ...knowledge.kinds],
      status: runWikiStatus(run),
      created: toIso(run.started_at),
      updated: toIso(run.ended_at ?? run.started_at),
      related: [`session-${sessionSlug}`, ...arefRunEntries],
      source: { kind: 'virtual', path: runRel },
      body: knowledge.body,
      raw: run,
      ext: {
        virtualKind: 'session-run', sessionId, runId, command,
        artifactIds: knowledge.artifactIds, arefArtifactIds: knowledge.arefArtifactIds, kinds: knowledge.kinds,
        gateSummary: {
          total: run.gates?.length ?? 0,
          waived: run.gates?.filter(gate => gate.status === 'waived').length ?? 0,
          failed: run.gates?.filter(gate => gate.status === 'failed').length ?? 0,
          blocked: run.gates?.filter(gate => gate.status === 'blocked').length ?? 0,
        },
      },
      scope: null,
      category: RUN_COMMAND_CATEGORY[command] ?? null,
      specCategory: null,
      createdBy: command,
      sourceRef: runId,
      parent: `session-${sessionSlug}`,
    });
  }

  runEntries.sort((left, right) => {
    const leftEnded = Date.parse(left.updated);
    const rightEnded = Date.parse(right.updated);
    const byEnded = (Number.isFinite(leftEnded) ? leftEnded : 0)
      - (Number.isFinite(rightEnded) ? rightEnded : 0);
    return byEnded || (left.sourceRef ?? left.id).localeCompare(right.sourceRef ?? right.id);
  });
  const latest = runEntries.at(-1);
  const summary = latest?.summary || session.lifecycle?.seal_summary || session.intent || '';
  const promotedRefs = [...new Set([
    ...(session.lifecycle?.promoted ?? []).map(ref => ref.trim()).filter(Boolean),
    ...(await readPromotedKnowledgeRefs(sessionDir, runNames, allowedRoot)),
  ])];
  const sessionEntry: WikiEntry = {
    id: `session-${sessionSlug}`,
    type: 'knowhow',
    title: session.intent || `Session ${sessionId}`,
    summary,
    tags: ['session', session.status!],
    status: sessionWikiStatus(session),
    created: toIso(session.created_at ?? session.lifecycle?.sealed_at),
    updated: toIso(session.updated_at ?? session.lifecycle?.sealed_at),
    related: runEntries.map(e => e.id),
    source: { kind: 'virtual', path: sessionRelPath },
    body: latest?.body ?? '',
    raw: session,
    ext: {
      virtualKind: 'session', sessionId, lifecycleStatus: session.status,
      runCount: runEntries.length, promotedRefs,
    },
    scope: null,
    category: null,
    specCategory: null,
    createdBy: 'session-runtime',
    sourceRef: sessionId,
    parent: null,
  };
  return [sessionEntry, ...runEntries];
}

// ── Claude Code / Codex session adapters ─────────────────────────────────
// Reads JSONL session transcripts from ~/.claude/ and ~/.codex/ and produces
// compact WikiEntry notes for search and wiki-load.

const MAX_SESSION_READ_BYTES = 512 * 1024;
const MAX_SESSION_PEEK_BYTES = 8 * 1024;
const MAX_USER_QUERIES = 25;
const MAX_QUERY_LENGTH = 200;

// Knowledge file path patterns → wiki entry ID derivation
const KNOWLEDGE_DIR_PATTERN = /[\\/]\.workflow[\\/](specs|knowhow|issues|domain)[\\/](.+)$/;

function deriveRelatedFromPaths(filePaths: Set<string>, sessionCwd: string): string[] {
  const related: string[] = [];
  const seen = new Set<string>();

  for (const fp of filePaths) {
    const normalized = fp.replace(/\\/g, '/');
    const m = KNOWLEDGE_DIR_PATTERN.exec(normalized);
    if (!m) continue;

    const [, dirType, relFile] = m;
    const stem = relFile.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '-');

    let id: string;
    switch (dirType) {
      case 'specs': id = `spec:project:${stem}`; break;
      case 'knowhow': id = `knowhow-${stem}`; break;
      case 'issues': continue; // JSONL issues use different ID scheme
      case 'domain': id = `domain-${stem}`; break;
      default: continue;
    }

    if (!seen.has(id)) {
      seen.add(id);
      related.push(id);
    }
  }

  return related.slice(0, 20);
}

async function readSessionHead(
  absPath: string,
  maxBytes = MAX_SESSION_READ_BYTES,
  allowedRoot = dirname(absPath),
): Promise<string[]> {
  const realPath = resolveAllowedDirectSourcePath(absPath, allowedRoot, 'file');
  if (!realPath) return [];
  let handle;
  try {
    handle = await open(realPath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf-8');
    const lines = text.split(/\r?\n/);
    if (bytesRead === maxBytes) lines.pop();
    return lines.filter(l => l.trim());
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}

async function peekSessionCwd(absPath: string, allowedRoot: string): Promise<string | null> {
  const lines = await readSessionHead(absPath, MAX_SESSION_PEEK_BYTES, allowedRoot);
  for (const line of lines.slice(0, 10)) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (row.type === 'session_meta') {
        const p = row.payload as Record<string, unknown>;
        return (p?.cwd as string) || null;
      }
    } catch { continue; }
  }
  return null;
}

function stripCommandTags(content: string): string {
  return content
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, '')
    .replace(/<command-name>(\/[^<]+)<\/command-name>/g, '$1')
    .replace(/<command-args>([^<]*)<\/command-args>/g, ' $1')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE_PREFIXES = ['Caveat:', '<local-command-caveat>', '<system-reminder>', 'No response requested'];
const NOISE_COMMANDS = new Set(['/clear', '/help', '/config', '/compact', 'clear', 'help']);

function isNoiseMessage(content: string): boolean {
  const t = content.trim();
  if (t.length === 0) return true;
  if (NOISE_COMMANDS.has(t)) return true;
  for (const p of NOISE_PREFIXES) { if (t.startsWith(p)) return true; }
  return false;
}

const CODEX_PROTOCOL_MARKERS = ['# Analysis Mode Protocol', '# Write Mode Protocol', 'PURPOSE:', '## Mode Definition', '## Prompt Structure', '## Operation Boundaries'];

function isCodexNoiseMessage(msg: string): boolean {
  if (msg.length > 500) {
    const head = msg.slice(0, 200);
    for (const m of CODEX_PROTOCOL_MARKERS) { if (head.includes(m)) return true; }
  }
  if (msg.length > 3000) return true;
  const t = msg.trim();
  if (t.length === 0) return true;
  return false;
}

function extractCommands(content: string): string[] {
  const cmds: string[] = [];
  const nameMatch = content.match(/<command-name>(\/[^<]+)<\/command-name>/);
  if (nameMatch) cmds.push(nameMatch[1]);
  const slashMatch = content.match(/^(\/[\w-]+)/);
  if (slashMatch && !cmds.includes(slashMatch[1])) cmds.push(slashMatch[1]);
  return cmds;
}

function buildSessionBody(meta: {
  platform: string;
  title: string;
  projectSlug: string;
  cwd: string;
  branch: string | null;
  firstTs: string | null;
  lastTs: string | null;
  turnCount: number;
  queries: string[];
  commands: string[];
}): string {
  const lines: string[] = [`# ${meta.title}`, ''];

  const infoParts = [meta.platform];
  if (meta.projectSlug) infoParts.push(meta.projectSlug);
  infoParts.push(meta.cwd);
  if (meta.branch) infoParts.push(`br:${meta.branch}`);
  if (meta.firstTs && meta.lastTs) {
    infoParts.push(`${meta.firstTs.slice(0, 16)} — ${meta.lastTs.slice(11, 16)}`);
  }
  infoParts.push(`${meta.turnCount}t`);
  lines.push(infoParts.join(' | '));

  if (meta.queries.length > 0) {
    lines.push('', '## Q');
    for (const q of meta.queries) lines.push(`- ${q}`);
  }

  if (meta.commands.length > 0) {
    const meaningful = meta.commands.filter(c => !NOISE_COMMANDS.has(c));
    if (meaningful.length > 0) {
      lines.push('', `Cmds: ${meaningful.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function slugify2(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Claude Code ──────────────────────────────────────────────────────────

export function adaptClaudeCodeSession(
  jsonlLines: string[],
  sourcePath: string,
  projectSlug: string,
): WikiEntry | null {
  let sessionId: string | null = null;
  let title: string | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let turnCount = 0;
  const queries: string[] = [];
  const commandSet = new Set<string>();
  const editedFilePaths = new Set<string>();

  for (const line of jsonlLines) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { continue; }

    const type = row.type as string;

    if (type === 'ai-title') {
      title = asString(row.aiTitle) || title;
      if (!sessionId) sessionId = asString(row.sessionId);
    }

    if (type === 'user') {
      turnCount++;
      const msg = row.message as Record<string, unknown> | undefined;
      const content = asString(msg?.content);
      const ts = asString(row.timestamp);

      if (!cwd) cwd = asString(row.cwd);
      if (!branch) branch = asString(row.gitBranch) || null;
      if (!sessionId) sessionId = asString(row.sessionId);
      if (!firstTs || (ts && ts < firstTs)) firstTs = ts;
      if (!lastTs || (ts && ts > lastTs)) lastTs = ts;

      for (const cmd of extractCommands(content)) commandSet.add(cmd);

      if (queries.length < MAX_USER_QUERIES && content) {
        const clean = stripCommandTags(content).slice(0, MAX_QUERY_LENGTH);
        if (clean.length > 5 && !isNoiseMessage(clean)) queries.push(clean);
      }
    }

    if (type === 'assistant') {
      const ts = asString(row.timestamp);
      if (!lastTs || (ts && ts > lastTs)) lastTs = ts;

      // Extract edited file paths from tool_use blocks
      const msg = row.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
            const input = block.input as Record<string, unknown> | undefined;
            const fp = asString(input?.file_path);
            if (fp && editedFilePaths.size < 50) editedFilePaths.add(fp);
          }
        }
      }
    }
  }

  if (!sessionId || turnCount === 0) return null;

  const displayTitle = title || `Claude session ${sessionId.slice(0, 8)}`;
  const slug = slugify2(sessionId);

  // Derive related wiki IDs from edited .workflow/ files
  const related = deriveRelatedFromPaths(editedFilePaths, cwd || '');

  const body = buildSessionBody({
    platform: 'Claude Code',
    title: displayTitle,
    projectSlug,
    cwd: cwd || '',
    branch,
    firstTs,
    lastTs,
    turnCount,
    queries,
    commands: [...commandSet],
  });

  const meaningfulCmds = [...commandSet].filter(c => !NOISE_COMMANDS.has(c));
  const tags: string[] = ['session', 'claude'];
  if (projectSlug) tags.push(projectSlug);
  if (branch) tags.push(branch);
  for (const cmd of meaningfulCmds) tags.push(cmd);

  return {
    id: `cc-session-${slug}`,
    type: 'note',
    title: displayTitle,
    summary: queries.slice(0, 3).join(' | ').slice(0, 240) || `Claude Code session (${turnCount} turns)`,
    tags: tags.slice(0, 15),
    status: 'completed',
    created: firstTs || toIso(null),
    updated: lastTs || toIso(null),
    related,
    source: { kind: 'virtual', path: sourcePath },
    body,
    raw: { sessionId, turnCount, commands: [...commandSet] },
    ext: {
      virtualKind: 'claude-session',
      sessionId,
      platform: 'claude',
      cwd: cwd || '',
      gitBranch: branch,
      turnCount,
      commandsUsed: [...commandSet],
      editedFiles: [...editedFilePaths].slice(0, 30),
    },
    scope: null,
    category: 'session',
    specCategory: null,
    createdBy: 'session-indexer',
    sourceRef: sessionId,
    parent: null,
  };
}

export async function loadClaudeCodeSessions(
  projectDir: string,
  projectSlug: string,
  maxAgeDays: number,
  maxFiles: number,
): Promise<WikiEntry[]> {
  const realProjectDir = resolveAllowedSourcePath(projectDir, projectDir, 'directory');
  if (!realProjectDir) return [];
  const names = await readAllowedSourceDir(realProjectDir, realProjectDir);
  const jsonlFiles = names.filter(n => n.endsWith('.jsonl')).slice(0, maxFiles * 3);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const { stat: fsStat } = await import('node:fs/promises');

  type FileInfo = { name: string; mtime: number };
  const candidates: FileInfo[] = [];
  for (const name of jsonlFiles) {
    try {
      const candidate = resolveAllowedDirectSourcePath(join(realProjectDir, name), realProjectDir, 'file');
      if (!candidate) continue;
      const s = await fsStat(candidate);
      if (s.mtimeMs >= cutoff && s.size > 200) {
        candidates.push({ name, mtime: s.mtimeMs });
      }
    } catch { continue; }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const out: WikiEntry[] = [];
  for (const c of candidates.slice(0, maxFiles)) {
    const absPath = join(realProjectDir, c.name);
    const lines = await readSessionHead(absPath, MAX_SESSION_READ_BYTES, realProjectDir);
    if (lines.length === 0) continue;
    const entry = adaptClaudeCodeSession(lines, `~/.claude/projects/${projectSlug}/${c.name}`, projectSlug);
    if (entry) out.push(entry);
  }
  return out;
}

// ── Codex ────────────────────────────────────────────────────────────────

export function adaptCodexSession(
  jsonlLines: string[],
  sourcePath: string,
  threadName: string | null,
): WikiEntry | null {
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let cliVersion: string | null = null;
  let model: string | null = null;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let turnCount = 0;
  const queries: string[] = [];
  const editedFilePaths = new Set<string>();

  for (const line of jsonlLines) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { continue; }

    const type = row.type as string;
    const ts = asString(row.timestamp);
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    if (type === 'session_meta') {
      const p = row.payload as Record<string, unknown> | undefined;
      if (p) {
        sessionId = asString(p.id) || sessionId;
        cwd = asString(p.cwd) || cwd;
        cliVersion = asString(p.cli_version) || cliVersion;
      }
    }

    if (type === 'turn_context') {
      const p = row.payload as Record<string, unknown> | undefined;
      if (p) {
        if (!cwd) cwd = asString(p.cwd) || null;
        if (!model) model = asString(p.model) || null;
      }
    }

    if (type === 'event_msg') {
      const p = row.payload as Record<string, unknown> | undefined;
      if (!p) continue;
      const evType = asString(p.type);

      if (evType === 'user_message') {
        turnCount++;
        const msg = asString(p.message);
        if (queries.length < MAX_USER_QUERIES && msg && !isCodexNoiseMessage(msg)) {
          const clean = msg.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
          if (clean.length > 10) queries.push(clean);
        }
      }

      // Extract file paths from tool_use / file_write events
      if (evType === 'tool_use' || evType === 'file_write' || evType === 'file_edit') {
        const fp = asString(p.file_path) || asString(p.path);
        if (fp && editedFilePaths.size < 50) editedFilePaths.add(fp);
      }
    }
  }

  if (!sessionId || turnCount === 0) return null;

  const displayTitle = threadName || `Codex session ${sessionId.slice(0, 8)}`;
  const slug = slugify2(sessionId);

  const related = deriveRelatedFromPaths(editedFilePaths, cwd || '');

  const body = buildSessionBody({
    platform: 'Codex',
    title: displayTitle,
    projectSlug: '',
    cwd: cwd || '',
    branch: null,
    firstTs,
    lastTs,
    turnCount,
    queries,
    commands: [],
  });

  const tags: string[] = ['session', 'codex'];
  if (model) tags.push(model);

  return {
    id: `cdx-session-${slug}`,
    type: 'note',
    title: displayTitle,
    summary: queries.slice(0, 3).join(' | ').slice(0, 240) || `Codex session (${turnCount} turns)`,
    tags: tags.slice(0, 15),
    status: 'completed',
    created: firstTs || toIso(null),
    updated: lastTs || toIso(null),
    related,
    source: { kind: 'virtual', path: sourcePath },
    body,
    raw: { sessionId, turnCount },
    ext: {
      virtualKind: 'codex-session',
      sessionId,
      platform: 'codex',
      cwd: cwd || '',
      cliVersion,
      model,
      turnCount,
      editedFiles: [...editedFilePaths].slice(0, 30),
    },
    scope: null,
    category: 'session',
    specCategory: null,
    createdBy: 'session-indexer',
    sourceRef: sessionId,
    parent: null,
  };
}

export interface CodexSessionIndex {
  id: string;
  threadName: string;
  updatedAt: string;
}

export async function loadCodexSessionIndex(codexRoot: string): Promise<Map<string, string>> {
  const indexPath = join(codexRoot, 'session_index.jsonl');
  const titleMap = new Map<string, string>();
  let raw: string;
  try { raw = await readAllowedSourceText(indexPath, codexRoot); } catch { return titleMap; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const id = asString(row.id);
      const name = asString(row.thread_name);
      if (id && name) titleMap.set(id, name);
    } catch { continue; }
  }
  return titleMap;
}

export async function loadCodexSessions(
  codexRoot: string,
  projectCwd: string,
  maxAgeDays: number,
  maxFiles: number,
): Promise<WikiEntry[]> {
  const realCodexRoot = resolveAllowedSourcePath(codexRoot, codexRoot, 'directory');
  if (!realCodexRoot) return [];
  const sessionsDir = join(realCodexRoot, 'sessions');
  const titleMap = await loadCodexSessionIndex(realCodexRoot);
  const cutoff = Date.now() - maxAgeDays * 86400000;

  const allFiles = await findJsonlFilesRecursive(
    sessionsDir,
    3,
    0,
    realCodexRoot,
    maxFiles * 3,
  );
  type FileInfo = { absPath: string; relPath: string; mtime: number };
  const candidates: FileInfo[] = [];
  for (const f of allFiles) {
    try {
      // findJsonlFilesRecursive already fences each candidate. A synchronous
      // stat avoids serial libuv round-trips across the bounded 300-file set.
      const s = lstatSync(f.absPath);
      if (s.mtimeMs >= cutoff && s.size > 200) {
        candidates.push({ ...f, mtime: s.mtimeMs });
      }
    } catch { continue; }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const normalizedProjectCwd = projectCwd.replace(/\\/g, '/').toLowerCase();
  const matchingCandidates: FileInfo[] = [];
  const peekConcurrency = 64;
  const recentCandidates = candidates.slice(0, maxFiles * 3);
  for (let offset = 0; offset < recentCandidates.length; offset += peekConcurrency) {
    const matches = await Promise.all(
      recentCandidates.slice(offset, offset + peekConcurrency).map(async candidate => {
        // Phase 1: peek only 8KB. Independent files are checked concurrently
        // so unrelated Codex histories do not add one I/O latency each.
        const sessionCwd = await peekSessionCwd(candidate.absPath, realCodexRoot);
        if (!sessionCwd) return null;
        const normalizedSessionCwd = sessionCwd.replace(/\\/g, '/').toLowerCase();
        return normalizedSessionCwd === normalizedProjectCwd ? candidate : null;
      }),
    );
    for (const match of matches) if (match) matchingCandidates.push(match);
  }

  const out: WikiEntry[] = [];
  const readConcurrency = 8;
  for (let offset = 0;
    offset < matchingCandidates.length && out.length < maxFiles;
    offset += readConcurrency) {
    const entries = await Promise.all(
      matchingCandidates.slice(offset, offset + readConcurrency).map(async candidate => {
        // Phase 2: full bounded read only for project-matching sessions.
        const lines = await readSessionHead(candidate.absPath, MAX_SESSION_READ_BYTES, realCodexRoot);
        if (lines.length === 0) return null;

        let sessionId: string | null = null;
        for (const line of lines.slice(0, 5)) {
          try {
            const row = JSON.parse(line) as Record<string, unknown>;
            if (row.type === 'session_meta') {
              const p = row.payload as Record<string, unknown>;
              sessionId = asString(p?.id) || null;
              break;
            }
          } catch { continue; }
        }

        const threadName = sessionId ? (titleMap.get(sessionId) ?? null) : null;
        return adaptCodexSession(lines, `~/.codex/${candidate.relPath}`, threadName);
      }),
    );
    for (const entry of entries) {
      if (entry) out.push(entry);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

async function findJsonlFilesRecursive(
  dir: string,
  maxDepth: number,
  currentDepth = 0,
  allowedRoot = dir,
  maxResults = 2_000,
): Promise<Array<{ absPath: string; relPath: string }>> {
  if (currentDepth > maxDepth) return [];
  const realDir = resolveAllowedDirectSourcePath(dir, allowedRoot, 'directory');
  if (!realDir) return [];
  const out: Array<{ absPath: string; relPath: string }> = [];
  const names = (await readAllowedSourceDir(realDir, allowedRoot)).sort().reverse();

  for (const name of names) {
    const full = join(realDir, name);
    try {
      const realChild = resolveAllowedDirectSourcePath(full, allowedRoot, 'any');
      if (!realChild) continue;
      const s = lstatSync(realChild);
      if (s.isDirectory()) {
        const sub = await findJsonlFilesRecursive(
          realChild,
          maxDepth,
          currentDepth + 1,
          allowedRoot,
          Math.max(0, maxResults - out.length),
        );
        out.push(...sub);
      } else if (name.endsWith('.jsonl')) {
        const sessionsIdx = realChild.replace(/\\/g, '/').indexOf('/sessions/');
        const relPath = sessionsIdx >= 0 ? `sessions${realChild.replace(/\\/g, '/').slice(sessionsIdx + '/sessions'.length)}` : name;
        out.push({ absPath: realChild, relPath });
      }
      if (out.length >= maxResults) break;
    } catch { continue; }
  }
  return out.slice(0, maxResults);
}

export function cwdToClaudeProjectSlug(cwd: string): string {
  return cwd
    .replace(/:/g, '')
    .replace(/[\\/]+/g, '--')
    .replace(/^-+|-+$/g, '');
}
