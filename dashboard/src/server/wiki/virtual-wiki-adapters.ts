import { readFile } from 'node:fs/promises';

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
