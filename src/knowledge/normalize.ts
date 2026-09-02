import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';

import {
  CANONICAL_KNOWLEDGE_CATEGORIES,
  normalizeCanonicalKnowledgeContent,
} from '../../shared/knowledge-content.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import {
  readRepositoryIdentity,
  type RepositoryIdentityManifest,
} from '../repository/context.js';
import { summarizeSessionKnowledge } from '../run/knowledge.js';
import { SessionStore } from '../run/store.js';
import { updateFileAtomic } from '../utils/atomic-write.js';

export type KnowledgeNormalizeScope = 'spec' | 'knowhow' | 'all';

export interface KnowledgeCompatibilityEntry {
  store: 'spec' | 'knowhow';
  file: string;
  entry: string;
  states: string[];
  normalizable: boolean;
}

export interface KnowledgeRepositoryDiagnostic {
  relation: 'current' | 'linked';
  alias: string;
  path: string;
  repo_id: string | null;
  cached_repo_id: string | null;
  identity_persisted: boolean;
  valid: boolean;
  read: string[];
  write: string[];
  error?: string;
}

export interface PendingCrossRepoPromotion {
  session_id: string;
  candidate_id: string;
  target: 'spec' | 'knowhow';
  status: string;
  source_repo_id: string;
  target_repo_id: string;
  target_alias_snapshot: string;
}

export interface KnowledgeCompatibilityReport {
  schema_version: 'knowledge-compatibility-audit/1.0';
  current_repository: KnowledgeRepositoryDiagnostic;
  linked_repositories: KnowledgeRepositoryDiagnostic[];
  entries: KnowledgeCompatibilityEntry[];
  pending_cross_repo_promotions: PendingCrossRepoPromotion[];
  counts: Record<string, number>;
}

export interface KnowledgeNormalizationAction {
  file: string;
  store: 'spec' | 'knowhow';
  before_sha256: string;
  after_sha256: string;
  changes: string[];
  blocked: string[];
}

export interface KnowledgeNormalizationReport {
  schema_version: 'knowledge-normalization-report/1.0';
  mode: 'dry-run';
  project_root: string;
  repo_id: string | null;
  scope: KnowledgeNormalizeScope;
  source_fingerprint: string;
  generated_at: string;
  actions: KnowledgeNormalizationAction[];
  unresolved: KnowledgeCompatibilityEntry[];
  safety: {
    report_required_before_apply: true;
    automatic_bulk_rewrite: false;
    backup_before_write: true;
  };
}

export interface KnowledgeNormalizationApplyResult {
  schema_version: 'knowledge-normalization-apply-result/1.0';
  applied: number;
  backup_dir: string | null;
  report_fingerprint: string;
  unresolved: number;
}

const SPEC_BLOCK_RE = /<spec-entry\s+([^>]+)>([\s\S]*?)<\/spec-entry>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_FIELDS = ['tags', 'specCategory', 'status', 'source', 'codePaths', 'lang', 'assetType'] as const;
const SPEC_ATTRIBUTE_ALIASES = [
  ...LEGACY_FIELDS, 'source-ref', 'related-paths', 'applies-to-repo-ids', 'lifecycle-status',
] as const;
const SPEC_CANONICAL_ATTRIBUTES = [
  'category', 'keywords', 'date', 'sid', 'title', 'sourceRef', 'ref',
  'relatedPaths', 'appliesToRepoIds', 'description', 'domain', 'confidence',
  'conflict-marker', 'conflict-note', 'conflict-date', 'supersedes',
  'superseded-by', 'lifecycleStatus',
] as const;
const KNOWHOW_LEGACY_FIELDS = [...LEGACY_FIELDS, 'id', 'description', 'body', 'content'] as const;
const KNOWHOW_CANONICAL_FIELDS = [
  'title', 'type', 'explicitId', 'created', 'updated', 'keywords', 'category',
  'sourceRef', 'relatedPaths', 'appliesToRepoIds', 'summary', 'language',
  'decisionState', 'lifecycleStatus', 'tool', 'confidence', 'related',
  'supersedes', 'supersededBy',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function rel(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function decodeXmlAttr(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, token: string) => {
    const named: Record<string, string> = {
      amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
    };
    const lower = token.toLowerCase();
    if (named[lower] !== undefined) return named[lower];
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    try {
      return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

function readAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(value)) !== null) attrs[match[1]] = decodeXmlAttr(match[2]);
  return attrs;
}

function compatibilityStates(
  input: Record<string, unknown>,
  unscoped: boolean,
  legacyFields: readonly string[] = LEGACY_FIELDS,
): string[] {
  const states: string[] = [];
  for (const field of legacyFields) if (input[field] !== undefined) states.push(`legacy-${field}`);
  if (typeof input.category === 'string'
    && !(CANONICAL_KNOWLEDGE_CATEGORIES as readonly string[]).includes(input.category)) {
    states.push('legacy-free-category');
  }
  if (unscoped) states.push('legacy-unscoped');
  return [...new Set(states)].sort();
}

function specCompatibility(projectRoot: string): KnowledgeCompatibilityEntry[] {
  const dir = join(projectRoot, '.workflow', 'specs');
  if (!existsSync(dir)) return [];
  const output: KnowledgeCompatibilityEntry[] = [];
  for (const name of readdirSync(dir).filter(file => file.endsWith('.md')).sort()) {
    const path = join(dir, name);
    const raw = readFileSync(path, 'utf8');
    SPEC_BLOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SPEC_BLOCK_RE.exec(raw)) !== null) {
      const attrs = readAttrs(match[1]);
      const states = compatibilityStates(attrs, !attrs.appliesToRepoIds && !attrs['applies-to-repo-ids']);
      if (states.length === 0) continue;
      output.push({
        store: 'spec',
        file: rel(projectRoot, path),
        entry: attrs.sid || attrs.title || `line:${raw.slice(0, match.index).split(/\r?\n/).length}`,
        states,
        normalizable: !states.includes('legacy-free-category'),
      });
    }
  }
  return output;
}

function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | null {
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) return null;
  const value = YAML.parse(match[1]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { data: value as Record<string, unknown>, body: match[2] };
}

function knowhowCompatibility(projectRoot: string): KnowledgeCompatibilityEntry[] {
  const dir = join(projectRoot, '.workflow', 'knowhow');
  if (!existsSync(dir)) return [];
  const output: KnowledgeCompatibilityEntry[] = [];
  for (const name of readdirSync(dir).filter(file => file.endsWith('.md')).sort()) {
    const path = join(dir, name);
    let parsed: { data: Record<string, unknown>; body: string } | null = null;
    try { parsed = splitFrontmatter(readFileSync(path, 'utf8')); } catch { /* regular audit reports parse errors */ }
    if (!parsed) continue;
    const states = compatibilityStates(
      parsed.data,
      !Array.isArray(parsed.data.appliesToRepoIds) || parsed.data.appliesToRepoIds.length === 0,
      KNOWHOW_LEGACY_FIELDS,
    );
    if (states.length === 0) continue;
    output.push({
      store: 'knowhow',
      file: rel(projectRoot, path),
      entry: typeof parsed.data.explicitId === 'string' ? parsed.data.explicitId : name,
      states,
      normalizable: !states.includes('legacy-free-category'),
    });
  }
  return output;
}

function currentDiagnostic(projectRoot: string): { diagnostic: KnowledgeRepositoryDiagnostic; identity: RepositoryIdentityManifest | null } {
  let identity: RepositoryIdentityManifest | null = null;
  let error: string | undefined;
  try { identity = readRepositoryIdentity(projectRoot); } catch (cause) { error = (cause as Error).message; }
  return {
    identity,
    diagnostic: {
      relation: 'current', alias: 'current', path: projectRoot,
      repo_id: identity?.repo_id ?? null, cached_repo_id: null,
      identity_persisted: Boolean(identity), valid: !error,
      read: [], write: [], ...(error ? { error } : {}),
    },
  };
}

function pendingPromotions(projectRoot: string): PendingCrossRepoPromotion[] {
  const store = new SessionStore(projectRoot);
  const output: PendingCrossRepoPromotion[] = [];
  for (const session of store.listSessionsReadOnly().candidates) {
    try {
      const summary = summarizeSessionKnowledge(projectRoot, session.sessionId, { readOnly: true, strict: true });
      for (const candidate of summary.candidates) {
        const binding = 'repository_binding' in candidate
          ? candidate.repository_binding
          : null;
        if (!binding || binding.source_repo_id === binding.target_repo_id
          || !['pending', 'promoting'].includes(candidate.status)) continue;
        output.push({
          session_id: session.sessionId,
          candidate_id: candidate.candidate_id,
          target: candidate.target,
          status: candidate.status,
          source_repo_id: binding.source_repo_id,
          target_repo_id: binding.target_repo_id,
          target_alias_snapshot: binding.target_alias_snapshot,
        });
      }
    } catch { /* pipeline audit owns malformed ledger diagnostics */ }
  }
  return output.sort((a, b) => a.session_id.localeCompare(b.session_id)
    || a.candidate_id.localeCompare(b.candidate_id));
}

export function inspectKnowledgeCompatibility(
  projectRootInput: string,
  scope: KnowledgeNormalizeScope = 'all',
): KnowledgeCompatibilityReport {
  const projectRoot = resolve(projectRootInput);
  const current = currentDiagnostic(projectRoot);
  const linked = resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot)).map(item => ({
    relation: 'linked' as const,
    alias: item.name,
    path: item.resolvedPath,
    repo_id: item.repoId,
    cached_repo_id: item.repo_id ?? null,
    identity_persisted: item.identityPersisted,
    valid: item.valid,
    read: [...item.share],
    write: [...(item.write ?? [])],
    ...(item.error ? { error: item.error } : {}),
  }));
  const entries = [
    ...(scope === 'all' || scope === 'spec' ? specCompatibility(projectRoot) : []),
    ...(scope === 'all' || scope === 'knowhow' ? knowhowCompatibility(projectRoot) : []),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.entry.localeCompare(b.entry));
  const pending = pendingPromotions(projectRoot);
  const counts: Record<string, number> = {
    entries: entries.length,
    missing_manifest: current.identity ? 0 : 1,
    invalid_links: linked.filter(item => !item.valid).length,
    linked_id_mismatches: linked.filter(item => item.error?.includes('identity mismatch')).length,
    pending_cross_repo_promotions: pending.length,
  };
  for (const entry of entries) for (const state of entry.states) counts[state] = (counts[state] ?? 0) + 1;
  return {
    schema_version: 'knowledge-compatibility-audit/1.0',
    current_repository: current.diagnostic,
    linked_repositories: linked,
    entries,
    pending_cross_repo_promotions: pending,
    counts,
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function repositoryScopeErrors(repoIds: string[]): string[] {
  return repoIds
    .filter(repoId => !UUID_RE.test(repoId))
    .map(repoId => `appliesToRepoIds must contain exact persisted repository IDs: ${repoId}`);
}

function normalizeSpecContent(raw: string, repoId: string | null): { content: string; changes: string[]; blocked: string[] } {
  const changes = new Set<string>();
  const blocked = new Set<string>();
  const content = raw.replace(SPEC_BLOCK_RE, (whole, attrText: string, body: string) => {
    const attrs = readAttrs(attrText);
    const canonical = normalizeCanonicalKnowledgeContent({
      category: attrs.category, specCategory: attrs.specCategory,
      keywords: attrs.keywords?.split(','), tags: attrs.tags?.split(','),
      sourceRef: attrs.sourceRef ?? attrs['source-ref'], source: attrs.source,
      relatedPaths: (attrs.relatedPaths ?? attrs['related-paths'])?.split(','),
      codePaths: attrs.codePaths?.split(','),
      appliesToRepoIds: (attrs.appliesToRepoIds ?? attrs['applies-to-repo-ids'])?.split(','),
      lifecycleStatus: attrs.lifecycleStatus ?? attrs['lifecycle-status'], status: attrs.status,
      content: body,
    });
    const entryBlocked = new Set([
      ...canonical.errors,
      ...repositoryScopeErrors(canonical.appliesToRepoIds),
    ]);
    if (canonical.auditMarkers.some(marker => marker.startsWith('legacy-category-as-keyword'))) {
      entryBlocked.add('legacy-free-category-requires-canonical-category');
    }
    if (entryBlocked.size > 0) {
      for (const error of entryBlocked) blocked.add(error);
      return whole;
    }

    // Rebuild rather than mutate the original attribute bag. Only attributes
    // in the canonical Spec schema can survive normalization; dual-read aliases
    // supply canonical values but are never emitted, and unknown index/path
    // metadata cannot become trusted merely because normalization touched it.
    const rebuilt: Record<string, string> = {};
    for (const field of SPEC_CANONICAL_ATTRIBUTES) {
      if (attrs[field] !== undefined) rebuilt[field] = attrs[field];
    }
    for (const field of Object.keys(attrs)) {
      if ((SPEC_CANONICAL_ATTRIBUTES as readonly string[]).includes(field)) continue;
      changes.add((SPEC_ATTRIBUTE_ALIASES as readonly string[]).includes(field)
        ? `${field}->canonical`
        : `${field}->removed`);
    }
    if (canonical.category) rebuilt.category = canonical.category;
    if (canonical.keywords.length > 0) rebuilt.keywords = canonical.keywords.join(',');
    if (canonical.sourceRef) rebuilt.sourceRef = canonical.sourceRef; else delete rebuilt.sourceRef;
    if (canonical.relatedPaths.length > 0) rebuilt.relatedPaths = canonical.relatedPaths.join(','); else delete rebuilt.relatedPaths;
    if (canonical.lifecycleStatus !== 'active') rebuilt.lifecycleStatus = canonical.lifecycleStatus; else delete rebuilt.lifecycleStatus;
    const scoped = canonical.appliesToRepoIds.length > 0 ? canonical.appliesToRepoIds : repoId ? [repoId] : [];
    if (scoped.length > 0) {
      rebuilt.appliesToRepoIds = scoped.join(',');
      if (canonical.appliesToRepoIds.length === 0) changes.add('legacy-unscoped->current-repo-id');
    } else {
      blocked.add('legacy-unscoped-requires-repository-manifest');
    }
    const ordered = SPEC_CANONICAL_ATTRIBUTES
      .filter(key => rebuilt[key] !== undefined)
      .map(key => `${key}="${escapeAttr(rebuilt[key])}"`)
      .join(' ');
    return `<spec-entry ${ordered}>${body}</spec-entry>`;
  });
  return { content, changes: [...changes].sort(), blocked: [...blocked].sort() };
}

function normalizeToolValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['false', 'no', '0', 'off', ''].includes(normalized)) return false;
  return true;
}

function normalizeKnowhowContent(raw: string, repoId: string | null): { content: string; changes: string[]; blocked: string[] } {
  const parsed = splitFrontmatter(raw);
  if (!parsed) return { content: raw, changes: [], blocked: ['invalid-or-missing-frontmatter'] };
  const documentBody = parsed.body.replace(/^\r?\n+/, '');
  const inlineContent = typeof parsed.data.content === 'string'
    ? parsed.data.content
    : typeof parsed.data.body === 'string'
      ? parsed.data.body
      : '';
  const canonical = normalizeCanonicalKnowledgeContent({
    ...parsed.data,
    explicitId: parsed.data.explicitId ?? parsed.data.id,
    summary: parsed.data.summary ?? parsed.data.description,
    description: undefined,
    content: documentBody.trim() ? documentBody : inlineContent,
    body: undefined,
    tool: normalizeToolValue(parsed.data.tool),
  });
  const blocked = new Set([
    ...canonical.errors,
    ...repositoryScopeErrors(canonical.appliesToRepoIds),
  ]);
  if (canonical.auditMarkers.some(marker => marker.startsWith('legacy-category-as-keyword'))) {
    blocked.add('legacy-free-category-requires-canonical-category');
  }
  const scoped = canonical.appliesToRepoIds.length > 0 ? canonical.appliesToRepoIds : repoId ? [repoId] : [];
  if (scoped.length === 0) blocked.add('legacy-unscoped-requires-repository-manifest');
  if (blocked.size > 0) {
    return { content: raw, changes: [], blocked: [...blocked].sort() };
  }

  const changes = new Set<string>();
  for (const field of KNOWHOW_LEGACY_FIELDS) {
    if (parsed.data[field] !== undefined) changes.add(`${field}->canonical`);
  }
  const data: Record<string, unknown> = {};
  for (const field of Object.keys(parsed.data)) {
    if (!(KNOWHOW_CANONICAL_FIELDS as readonly string[]).includes(field)
      && !(KNOWHOW_LEGACY_FIELDS as readonly string[]).includes(field)) {
      changes.add(`${field}->removed`);
    }
  }
  data.title = canonical.title;
  if (canonical.type) data.type = canonical.type;
  if (canonical.explicitId) data.explicitId = canonical.explicitId;
  if (parsed.data.created !== undefined) data.created = parsed.data.created;
  if (parsed.data.updated !== undefined) data.updated = parsed.data.updated;
  if (canonical.keywords.length > 0) data.keywords = canonical.keywords;
  if (canonical.category) data.category = canonical.category;
  if (canonical.sourceRef) data.sourceRef = canonical.sourceRef;
  if (canonical.relatedPaths.length > 0) data.relatedPaths = canonical.relatedPaths;
  data.appliesToRepoIds = scoped;
  if (canonical.summary) data.summary = canonical.summary;
  if (canonical.language) data.language = canonical.language;
  if (canonical.decisionState) data.decisionState = canonical.decisionState;
  data.lifecycleStatus = canonical.lifecycleStatus;
  if (canonical.tool) data.tool = true;
  for (const field of ['confidence', 'related', 'supersedes', 'supersededBy'] as const) {
    if (parsed.data[field] !== undefined) data[field] = parsed.data[field];
  }
  if (canonical.appliesToRepoIds.length === 0) changes.add('legacy-unscoped->current-repo-id');

  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = canonical.content.replace(/\r?\n/g, eol).replace(/^(?:\r?\n)+/, '');
  return {
    content: `---${eol}${yaml.replace(/\n/g, eol)}${eol}---${eol}${eol}${body}`,
    changes: [...changes].sort(),
    blocked: [],
  };
}

function sourceFingerprint(actions: KnowledgeNormalizationAction[]): string {
  return sha256(JSON.stringify(actions.map(action => ({ file: action.file, before_sha256: action.before_sha256 }))));
}

function buildActions(projectRoot: string, scope: KnowledgeNormalizeScope, repoId: string | null): KnowledgeNormalizationAction[] {
  const paths: Array<{ path: string; store: 'spec' | 'knowhow' }> = [];
  for (const store of ['spec', 'knowhow'] as const) {
    if (scope !== 'all' && scope !== store) continue;
    const dir = join(projectRoot, '.workflow', store === 'spec' ? 'specs' : 'knowhow');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith('.md')).sort()) paths.push({ path: join(dir, name), store });
  }
  const actions: KnowledgeNormalizationAction[] = [];
  for (const item of paths) {
    const before = readFileSync(item.path, 'utf8');
    const normalized = item.store === 'spec'
      ? normalizeSpecContent(before, repoId)
      : normalizeKnowhowContent(before, repoId);
    if (normalized.content === before && normalized.blocked.length === 0) continue;
    actions.push({
      file: rel(projectRoot, item.path), store: item.store,
      before_sha256: sha256(before), after_sha256: sha256(normalized.content),
      changes: normalized.changes, blocked: normalized.blocked,
    });
  }
  return actions;
}

export function planKnowledgeNormalization(
  projectRootInput: string,
  scope: KnowledgeNormalizeScope = 'all',
): KnowledgeNormalizationReport {
  const projectRoot = resolve(projectRootInput);
  const compatibility = inspectKnowledgeCompatibility(projectRoot, scope);
  const repoId = compatibility.current_repository.repo_id;
  const actions = buildActions(projectRoot, scope, repoId);
  const actionableFiles = new Set(actions.filter(action => action.blocked.length === 0).map(action => action.file));
  return {
    schema_version: 'knowledge-normalization-report/1.0', mode: 'dry-run',
    project_root: projectRoot, repo_id: repoId, scope,
    source_fingerprint: sourceFingerprint(actions), generated_at: new Date().toISOString(),
    actions,
    unresolved: compatibility.entries.filter(entry => !entry.normalizable || !actionableFiles.has(entry.file)),
    safety: { report_required_before_apply: true, automatic_bulk_rewrite: false, backup_before_write: true },
  };
}

export function writeKnowledgeNormalizationReport(pathInput: string, report: KnowledgeNormalizationReport): void {
  const path = resolve(pathInput);
  mkdirSync(dirname(path), { recursive: true });
  updateFileAtomic(path, () => `${JSON.stringify(report, null, 2)}\n`);
}

function parseReport(path: string): KnowledgeNormalizationReport {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeNormalizationReport;
  if (raw.schema_version !== 'knowledge-normalization-report/1.0' || raw.mode !== 'dry-run'
    || !Array.isArray(raw.actions) || typeof raw.source_fingerprint !== 'string') {
    throw new Error(`Invalid knowledge normalization report: ${path}`);
  }
  return raw;
}

export function applyKnowledgeNormalization(
  projectRootInput: string,
  reportPathInput: string,
): KnowledgeNormalizationApplyResult {
  const projectRoot = resolve(projectRootInput);
  const reportPath = resolve(reportPathInput);
  if (!existsSync(reportPath)) throw new Error('Normalization apply requires an existing dry-run report');
  const report = parseReport(reportPath);
  if (resolve(report.project_root) !== projectRoot) throw new Error('Normalization report targets a different project root');
  const currentIdentity = currentDiagnostic(projectRoot).identity;
  if ((currentIdentity?.repo_id ?? null) !== report.repo_id) throw new Error('Repository identity changed after normalization dry-run');
  const current = planKnowledgeNormalization(projectRoot, report.scope);
  if (current.source_fingerprint !== report.source_fingerprint
    || JSON.stringify(current.actions) !== JSON.stringify(report.actions)) {
    throw new Error('Knowledge sources changed after normalization dry-run; generate a fresh report');
  }
  const actionable = report.actions.filter(action => action.blocked.length === 0 && action.before_sha256 !== action.after_sha256);
  if (actionable.length === 0) {
    return { schema_version: 'knowledge-normalization-apply-result/1.0', applied: 0, backup_dir: null,
      report_fingerprint: report.source_fingerprint, unresolved: report.unresolved.length };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(projectRoot, '.workflow', '.trash', `knowledge-normalize-${stamp}`);
  for (const action of actionable) {
    const source = join(projectRoot, action.file);
    const backup = join(backupDir, action.file);
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(source, backup);
  }
  let applied = 0;
  try {
    for (const action of actionable) {
      const path = join(projectRoot, action.file);
      updateFileAtomic(path, before => {
        if (before === null || sha256(before) !== action.before_sha256) throw new Error(`Source changed before apply: ${action.file}`);
        const normalized = action.store === 'spec'
          ? normalizeSpecContent(before, report.repo_id)
          : normalizeKnowhowContent(before, report.repo_id);
        if (sha256(normalized.content) !== action.after_sha256) throw new Error(`Normalization plan drifted: ${action.file}`);
        return normalized.content;
      });
      applied++;
    }
  } catch (error) {
    for (const action of actionable.slice(0, applied)) {
      const path = join(projectRoot, action.file);
      const backup = join(backupDir, action.file);
      updateFileAtomic(path, () => readFileSync(backup, 'utf8'));
    }
    throw error;
  }
  return {
    schema_version: 'knowledge-normalization-apply-result/1.0', applied,
    backup_dir: rel(projectRoot, backupDir), report_fingerprint: report.source_fingerprint,
    unresolved: report.unresolved.length,
  };
}

export function isExactRepositoryId(value: string): boolean {
  return UUID_RE.test(value);
}
