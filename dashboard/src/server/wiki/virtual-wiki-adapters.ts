import { readFile, open } from 'node:fs/promises';

import type { GraphNode, GraphEdge, Layer, TourStep, KnowledgeGraph } from '../../../../src/graph/types.js';
import type { WikiEntry, WikiStatus } from './wiki-types.js';

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
    tags,
    status: mapIssueStatus(r.status),
    created: toIso(r.created_at),
    updated: toIso(r.updated_at),
    related: [],
    source: { kind: 'virtual', path: sourcePath, line },
    body: '',
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

function stableKgId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
      .map(e => `kg-${stableKgId(e.target)}`);

    out.push({
      id: `kg-${stableKgId(n.id)}`,
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
          target: `kg-${stableKgId(e.target)}`,
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
      id: `kg-layer-${stableKgId(l.id)}`,
      type: 'knowhow',
      title: l.name || l.id,
      summary: (l.description || '').slice(0, opts.maxSummaryLength),
      tags: ['kg', 'kg:layer'],
      status: 'active',
      created: ts,
      updated: ts,
      related: (l.nodeIds ?? []).slice(0, opts.maxRelatedPerNode).map(id => `kg-${stableKgId(id)}`),
      source: { kind: 'virtual', path: sourcePath },
      body: '',
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
      tags: ['kg', 'kg:tour'],
      status: 'active',
      created: ts,
      updated: ts,
      related: (step.nodeIds ?? []).slice(0, opts.maxRelatedPerNode).map(id => `kg-${stableKgId(id)}`),
      source: { kind: 'virtual', path: sourcePath },
      body: '',
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
      tags: ['requirement', ...(r.priority ? [r.priority] : []), ...(r.status ? [r.status] : [])],
      status: mapCodebaseStatus(r.status),
      created: ts,
      updated: ts,
      related: r.feature_id ? [`codebase-feat-${r.feature_id.toLowerCase()}`] : [],
      source: { kind: 'virtual', path: sourcePath },
      body: '',
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
      tags: ['adr', ...compIds],
      status: 'completed',
      created: ts,
      updated: ts,
      related: compIds.map(id => `codebase-comp-${id.toLowerCase()}`),
      source: { kind: 'virtual', path: sourcePath },
      body: '',
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

// ── Session archive adapter (lifecycle-aware) ───────────────────────────
// Strategy 2: only sessions with archive.json declaring lifecycle.status of
// 'sealed' or 'archived' enter the wiki index. Sessions without archive.json
// (or with status 'active') are excluded — agents must not see promises as
// truth.
//
// Source: any .workflow/scratch/*/archive.json (sealed before milestone close)
//      or .workflow/milestones/*/artifacts/*/archive.json (archived).
// Schema: "session-archive/1.0".
//
// Content summary is read lazily from referenced files (currently
// context-package.json if listed in content_refs); archive.json itself only
// carries lifecycle + content_refs + pruning metadata.

type SessionLifecycleStatus = 'active' | 'sealed' | 'archived';

interface SessionLifecycle {
  status?: SessionLifecycleStatus;
  sealed_at?: string | null;
  archived_at?: string | null;
  linked_milestone?: string | null;
}

interface SessionContentRef {
  type?: string;
  path?: string;
}

interface SessionPruned {
  at?: string;
  counts?: {
    open_questions?: number;
    constraints?: number;
    insights?: number;
    references?: number;
  };
  ref?: string | null;
}

interface SessionArchive {
  $schema?: string;
  session_id?: string;
  session_type?: string;
  session_path?: string;
  lifecycle?: SessionLifecycle;
  content_refs?: SessionContentRef[];
  pruned?: SessionPruned | null;
}

interface ContextPackageInsight {
  role?: string;
  area?: string;
  summary?: string;
}

interface ContextPackageConstraint {
  area?: string;
}

interface ContextPackagePeek {
  insights?: ContextPackageInsight[];
  constraints?: ContextPackageConstraint[];
  open_questions?: unknown[];
  requirements?: unknown[];
  domain?: { problem_statement?: string };
}

const SESSION_TYPE_CATEGORY: Record<string, string> = {
  brainstorm: 'arch',
  blueprint: 'arch',
  analyze: 'arch',
  plan: 'coding',
  execute: 'coding',
  verify: 'review',
};

function mapSessionStatus(status: SessionLifecycleStatus): WikiStatus {
  return status === 'archived' ? 'archived' : 'completed';
}

function buildArchiveSummary(arch: SessionArchive, peek: ContextPackagePeek | null): string {
  const parts: string[] = [];
  const problem = peek?.domain?.problem_statement;
  if (problem) parts.push(problem.slice(0, 200));
  const insightCount = peek?.insights?.length ?? 0;
  const constraintCount = peek?.constraints?.length ?? 0;
  const questionCount = peek?.open_questions?.length ?? 0;
  if (insightCount || constraintCount || questionCount) {
    parts.push(`${insightCount} insights / ${constraintCount} constraints / ${questionCount} open questions`);
  }
  if (arch.pruned?.counts) {
    const c = arch.pruned.counts;
    const total = (c.open_questions ?? 0) + (c.constraints ?? 0) + (c.insights ?? 0) + (c.references ?? 0);
    if (total > 0) parts.push(`pruned: ${total} items`);
  }
  const topInsight = peek?.insights?.[0]?.summary;
  if (topInsight && !problem) parts.push(topInsight.slice(0, 200));
  return parts.join(' | ');
}

function buildArchiveTags(
  sessionType: string,
  status: SessionLifecycleStatus,
  peek: ContextPackagePeek | null,
): string[] {
  const tags: string[] = ['session', status, sessionType];
  for (const c of peek?.constraints ?? []) {
    if (c.area && tags.length < 12) tags.push(c.area);
  }
  return tags;
}

/**
 * Adapter for session archive.json files. Returns the lazy reader pattern:
 * pass `peekContextPackage` to enrich summary/tags from context-package.json
 * sibling. If unavailable, archive metadata alone is used.
 */
export function adaptSessionArchive(
  parsed: unknown,
  sourcePath: string,
  peek: ContextPackagePeek | null = null,
): WikiEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const arch = parsed as SessionArchive;
  const status: SessionLifecycleStatus = arch.lifecycle?.status ?? 'active';
  if (status === 'active') return [];

  const sessionType = arch.session_type ?? 'session';
  const sessionId = arch.session_id ?? arch.session_path ?? sourcePath;
  const slug = slugify(sessionId);
  if (!slug) return [];

  const sessionDir = sourcePath.replace(/\/archive\.json$/, '');
  const sealedAt = toIso(arch.lifecycle?.sealed_at);
  const archivedAt = toIso(arch.lifecycle?.archived_at ?? arch.lifecycle?.sealed_at);

  const related: string[] = [];
  if (arch.lifecycle?.linked_milestone) {
    related.push(`milestone-${arch.lifecycle.linked_milestone}`);
  }
  for (const ref of arch.content_refs ?? []) {
    if (ref?.path) related.push(`session-ref-${slugify(ref.path)}`);
  }

  return [{
    id: `session-${sessionType}-${slug}`,
    type: 'knowhow',
    title: `${sessionType} ${arch.session_id ?? slug}`,
    summary: buildArchiveSummary(arch, peek),
    tags: buildArchiveTags(sessionType, status, peek),
    status: mapSessionStatus(status),
    created: sealedAt,
    updated: archivedAt,
    related,
    source: { kind: 'virtual', path: sourcePath },
    body: '',
    raw: arch,
    ext: {
      virtualKind: 'session',
      sessionType,
      lifecycleStatus: status,
      sessionDir,
      linkedMilestone: arch.lifecycle?.linked_milestone ?? null,
      contentRefs: arch.content_refs ?? [],
      pruned: arch.pruned ?? null,
      insightCount: peek?.insights?.length ?? 0,
      constraintCount: peek?.constraints?.length ?? 0,
      openQuestionCount: peek?.open_questions?.length ?? 0,
      requirementCount: peek?.requirements?.length ?? 0,
    },
    scope: null,
    category: SESSION_TYPE_CATEGORY[sessionType] ?? null,
    specCategory: null,
    createdBy: sessionType,
    sourceRef: arch.session_id ?? null,
    parent: null,
  }];
}

/**
 * Reads archive.json + optional sibling context-package.json (for summary
 * enrichment) and returns adapted WikiEntries. Tolerates missing/malformed
 * context-package — only archive.json is required.
 */
export async function loadSessionArchiveEntries(
  archiveAbsPath: string,
  archiveRelPath: string,
): Promise<WikiEntry[]> {
  let archiveRaw: string;
  try {
    archiveRaw = await readFile(archiveAbsPath, 'utf-8');
  } catch {
    return [];
  }
  let parsedArchive: unknown;
  try {
    parsedArchive = JSON.parse(archiveRaw);
  } catch {
    warn(`bad-json:${archiveAbsPath}`, `invalid JSON at ${archiveAbsPath}`);
    return [];
  }

  // Sibling context-package.json (lazy peek; absent or malformed is fine)
  let peek: ContextPackagePeek | null = null;
  const peekPath = archiveAbsPath.replace(/archive\.json$/, 'context-package.json');
  try {
    const peekRaw = await readFile(peekPath, 'utf-8');
    const parsed = JSON.parse(peekRaw);
    if (parsed && typeof parsed === 'object') peek = parsed as ContextPackagePeek;
  } catch {
    /* peek is optional */
  }

  try {
    return adaptSessionArchive(parsedArchive, archiveRelPath, peek);
  } catch (err) {
    warn(`adapter-fail:${archiveAbsPath}`, `adapter failed at ${archiveAbsPath}: ${(err as Error).message}`);
    return [];
  }
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
      case 'specs': id = `spec-${stem}`; break;
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

async function readSessionHead(absPath: string, maxBytes = MAX_SESSION_READ_BYTES): Promise<string[]> {
  let handle;
  try {
    handle = await open(absPath, 'r');
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

async function peekSessionCwd(absPath: string): Promise<string | null> {
  const lines = await readSessionHead(absPath, MAX_SESSION_PEEK_BYTES);
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
  const names = await safeReaddirLocal(projectDir);
  const jsonlFiles = names.filter(n => n.endsWith('.jsonl'));
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const { stat: fsStat } = await import('node:fs/promises');

  type FileInfo = { name: string; mtime: number };
  const candidates: FileInfo[] = [];
  for (const name of jsonlFiles) {
    try {
      const s = await fsStat(`${projectDir}/${name}`);
      if (s.mtimeMs >= cutoff && s.size > 200) {
        candidates.push({ name, mtime: s.mtimeMs });
      }
    } catch { continue; }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const out: WikiEntry[] = [];
  for (const c of candidates.slice(0, maxFiles)) {
    const absPath = `${projectDir}/${c.name}`;
    const lines = await readSessionHead(absPath);
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
  const indexPath = `${codexRoot}/session_index.jsonl`;
  const titleMap = new Map<string, string>();
  let raw: string;
  try { raw = await readFile(indexPath, 'utf-8'); } catch { return titleMap; }
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
  const sessionsDir = `${codexRoot}/sessions`;
  const titleMap = await loadCodexSessionIndex(codexRoot);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const { stat: fsStat } = await import('node:fs/promises');

  const allFiles = await findJsonlFilesRecursive(sessionsDir, 3);
  type FileInfo = { absPath: string; relPath: string; mtime: number };
  const candidates: FileInfo[] = [];
  for (const f of allFiles) {
    try {
      const s = await fsStat(f.absPath);
      if (s.mtimeMs >= cutoff && s.size > 200) {
        candidates.push({ ...f, mtime: s.mtimeMs });
      }
    } catch { continue; }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const normalizedProjectCwd = projectCwd.replace(/\\/g, '/').toLowerCase();
  const out: WikiEntry[] = [];

  for (const c of candidates.slice(0, maxFiles * 3)) {
    if (out.length >= maxFiles) break;

    // Phase 1: peek first 8KB to check CWD match (avoids reading 512KB for non-matching sessions)
    const sessionCwd = await peekSessionCwd(c.absPath);
    if (!sessionCwd) continue;
    const normalizedSessionCwd = sessionCwd.replace(/\\/g, '/').toLowerCase();
    if (normalizedSessionCwd !== normalizedProjectCwd) continue;

    // Phase 2: full read only for matching sessions
    const lines = await readSessionHead(c.absPath);
    if (lines.length === 0) continue;

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
    const entry = adaptCodexSession(lines, `~/.codex/${c.relPath}`, threadName);
    if (entry) out.push(entry);
  }
  return out;
}

async function findJsonlFilesRecursive(
  dir: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<Array<{ absPath: string; relPath: string }>> {
  if (currentDepth > maxDepth) return [];
  const out: Array<{ absPath: string; relPath: string }> = [];
  const names = await safeReaddirLocal(dir);
  const { stat: fsStat } = await import('node:fs/promises');

  for (const name of names) {
    const full = `${dir}/${name}`;
    try {
      const s = await fsStat(full);
      if (s.isDirectory()) {
        const sub = await findJsonlFilesRecursive(full, maxDepth, currentDepth + 1);
        out.push(...sub);
      } else if (name.endsWith('.jsonl')) {
        const sessionsIdx = full.replace(/\\/g, '/').indexOf('/sessions/');
        const relPath = sessionsIdx >= 0 ? `sessions${full.replace(/\\/g, '/').slice(sessionsIdx + '/sessions'.length)}` : name;
        out.push({ absPath: full, relPath });
      }
    } catch { continue; }
  }
  return out;
}

async function safeReaddirLocal(dir: string): Promise<string[]> {
  const { readdir: fsReaddir } = await import('node:fs/promises');
  try { return await fsReaddir(dir); } catch { return []; }
}

export function cwdToClaudeProjectSlug(cwd: string): string {
  return cwd
    .replace(/:/g, '')
    .replace(/[\\/]+/g, '--')
    .replace(/^-+|-+$/g, '');
}
