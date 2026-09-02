import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { WorkspaceConfig, WorkspaceCorpus, WorkspaceLink } from '../types/index.js';
import {
  acquireFileLocksSync,
  knowledgeCorpusNamespaceTarget,
} from '../utils/atomic-write.js';
import type {
  AgentRepositoryBinding,
  AgentRepositoryContext,
} from '../../shared/agent-types.js';
import { canonicalWorkspaceId } from '../run/intent-identity.js';

export const REPOSITORY_IDENTITY_SCHEMA = 'repository-identity/1.0' as const;
export const REPOSITORY_IDENTITY_PATH = join('.workflow', 'repository.json');
export const CURRENT_REPOSITORY_ALIAS = 'current' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RepositoryIdentityManifest {
  schema_version: typeof REPOSITORY_IDENTITY_SCHEMA;
  repo_id: string;
  repo_name: string;
  created_at: string;
}

export type RepositoryRelation = 'current' | 'linked';

export interface RepositoryContext {
  /** Null only for a readable legacy repository with no persisted manifest. */
  repoId: string | null;
  repoName: string;
  /** Historical path-derived workspace identity. This intentionally does not use repoId. */
  workspaceId: string;
  projectRoot: string;
  workflowRoot: string;
  /** Host repository whose link configuration grants this authority. */
  authorityRoot: string;
  relation: RepositoryRelation;
  alias: string;
  identityPersisted: boolean;
  read: WorkspaceCorpus[];
  write: WorkspaceCorpus[];
}

export interface InspectedWorkspaceLink {
  resolvedPath: string;
  workflowRoot: string;
  valid: boolean;
  identityPersisted: boolean;
  repoId: string | null;
  repoName: string;
  error?: string;
}

function normalizedForComparison(path: string): string {
  let normalized = resolve(path);
  if (dirname(normalized) !== normalized) normalized = normalized.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathContained(candidate: string, root: string): boolean {
  const canonicalCandidate = normalizedForComparison(candidate);
  const canonicalRoot = normalizedForComparison(root);
  const rel = relative(canonicalRoot, canonicalCandidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function canonicalizeRepositoryRoot(projectRoot: string): string {
  const absolute = resolve(projectRoot);
  if (!existsSync(absolute)) throw new Error(`Repository path does not exist: ${absolute}`);
  const canonical = realpathSync(absolute);
  if (!lstatSync(canonical).isDirectory()) throw new Error(`Repository path is not a directory: ${canonical}`);
  return canonical;
}

function validateWorkflowBoundary(projectRoot: string): string {
  const workflowPath = join(projectRoot, '.workflow');
  if (!existsSync(workflowPath)) throw new Error(`No .workflow directory found at ${projectRoot}`);
  const workflowRoot = realpathSync(workflowPath);
  if (!isPathContained(workflowRoot, projectRoot)) {
    throw new Error(`Unsafe .workflow symlink escapes repository root: ${workflowPath}`);
  }
  if (!lstatSync(workflowRoot).isDirectory()) throw new Error(`.workflow is not a directory: ${workflowPath}`);
  return workflowRoot;
}

function validateManifest(value: unknown, manifestPath: string): RepositoryIdentityManifest {
  if (!value || typeof value !== 'object') throw new Error(`Invalid repository identity manifest: ${manifestPath}`);
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== REPOSITORY_IDENTITY_SCHEMA) {
    throw new Error(`Unsupported repository identity schema in ${manifestPath}`);
  }
  if (typeof raw.repo_id !== 'string' || !UUID_PATTERN.test(raw.repo_id)) {
    throw new Error(`Invalid repo_id in ${manifestPath}`);
  }
  if (typeof raw.repo_name !== 'string' || !raw.repo_name.trim()) {
    throw new Error(`Invalid repo_name in ${manifestPath}`);
  }
  if (typeof raw.created_at !== 'string' || !Number.isFinite(Date.parse(raw.created_at))) {
    throw new Error(`Invalid created_at in ${manifestPath}`);
  }
  return {
    schema_version: REPOSITORY_IDENTITY_SCHEMA,
    repo_id: raw.repo_id,
    repo_name: raw.repo_name.trim(),
    created_at: raw.created_at,
  };
}

export function readRepositoryIdentity(projectRoot: string): RepositoryIdentityManifest | null {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  const workflowRoot = validateWorkflowBoundary(canonicalRoot);
  const manifestPath = join(workflowRoot, 'repository.json');
  if (!existsSync(manifestPath)) return null;
  const canonicalManifestPath = realpathSync(manifestPath);
  if (!isPathContained(canonicalManifestPath, workflowRoot)) {
    throw new Error(`Unsafe repository manifest symlink escapes .workflow: ${manifestPath}`);
  }
  try {
    return validateManifest(JSON.parse(readFileSync(canonicalManifestPath, 'utf8')), manifestPath);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in repository identity manifest: ${manifestPath}`);
    throw error;
  }
}

function writeRepositoryIdentity(projectRoot: string, manifest: RepositoryIdentityManifest): void {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  const workflowRoot = join(canonicalRoot, '.workflow');
  mkdirSync(workflowRoot, { recursive: true });
  const canonicalWorkflowRoot = validateWorkflowBoundary(canonicalRoot);
  const manifestPath = join(canonicalWorkflowRoot, 'repository.json');
  const release = acquireFileLocksSync([manifestPath]);
  try {
    if (existsSync(manifestPath)) {
      const canonicalManifestPath = realpathSync(manifestPath);
      if (!isPathContained(canonicalManifestPath, canonicalWorkflowRoot)) {
        throw new Error(`Unsafe repository manifest symlink escapes .workflow: ${manifestPath}`);
      }
    }
    const tempPath = join(canonicalWorkflowRoot, `.repository.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(tempPath, manifestPath);
  } finally {
    release();
  }
}

export function initializeRepositoryIdentity(
  projectRoot: string,
  options: { repoName?: string } = {},
): RepositoryIdentityManifest {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  mkdirSync(join(canonicalRoot, '.workflow'), { recursive: true });
  const manifestPath = join(canonicalRoot, REPOSITORY_IDENTITY_PATH);
  const release = acquireFileLocksSync([manifestPath]);
  try {
    // The existence check must share the manifest lock with creation. Otherwise
    // two initializers can both observe absence and the later rename silently
    // replaces the identity written by the winner.
    const existing = readRepositoryIdentity(canonicalRoot);
    if (existing) return existing;
    const repoName = (options.repoName ?? basename(canonicalRoot)).trim();
    if (!repoName) throw new Error('Repository name must not be empty');
    const manifest: RepositoryIdentityManifest = {
      schema_version: REPOSITORY_IDENTITY_SCHEMA,
      repo_id: randomUUID(),
      repo_name: repoName,
      created_at: new Date().toISOString(),
    };
    writeRepositoryIdentity(canonicalRoot, manifest);
    return manifest;
  } finally {
    release();
  }
}

export function reseedRepositoryIdentity(
  projectRoot: string,
  options: { repoName?: string } = {},
): { previous: RepositoryIdentityManifest | null; current: RepositoryIdentityManifest } {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  mkdirSync(join(canonicalRoot, '.workflow'), { recursive: true });
  const previous = readRepositoryIdentity(canonicalRoot);
  const repoName = (options.repoName ?? previous?.repo_name ?? basename(canonicalRoot)).trim();
  if (!repoName) throw new Error('Repository name must not be empty');
  const current: RepositoryIdentityManifest = {
    schema_version: REPOSITORY_IDENTITY_SCHEMA,
    repo_id: randomUUID(),
    repo_name: repoName,
    created_at: new Date().toISOString(),
  };
  writeRepositoryIdentity(canonicalRoot, current);
  return { previous, current };
}

function isWorkspaceCarrier(dir: string): boolean {
  const workflowRoot = join(dir, '.workflow');
  if (!existsSync(workflowRoot)) return false;
  if (existsSync(join(workflowRoot, 'repository.json'))) {
    try {
      return readRepositoryIdentity(dir) !== null;
    } catch {
      return false;
    }
  }
  if (existsSync(join(workflowRoot, 'kg', 'maestro.db'))) return true;
  const statePath = join(workflowRoot, 'state.json');
  if (!existsSync(statePath)) return false;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    return state.version !== undefined
      && (typeof state.phases_summary === 'object'
        || Array.isArray(state.sessions)
        || typeof state.active_session_id === 'string'
        || existsSync(join(workflowRoot, 'sessions'))
        || existsSync(join(workflowRoot, '.maestro')));
  } catch {
    return false;
  }
}

/** Find and canonicalize the nearest repository boundary without mutating identity. */
export function findRepositoryRoot(startDir: string): string | null {
  let dir: string;
  try {
    const absolute = resolve(startDir);
    dir = existsSync(absolute) ? realpathSync(absolute) : absolute;
  } catch {
    return null;
  }
  for (let i = 0; i < 100; i += 1) {
    const workflowRoot = join(dir, '.workflow');
    const hasMarker = existsSync(join(workflowRoot, 'repository.json'))
      || existsSync(join(workflowRoot, 'kg', 'maestro.db'))
      || existsSync(join(workflowRoot, 'state.json'));
    if (hasMarker && !isWorkspaceCarrier(dir)) return null;
    if (hasMarker) {
      try {
        validateWorkflowBoundary(dir);
        // The nearest initialized Maestro workspace is the repository boundary.
        // Do not let an enclosing Git checkout steal nested hermetic/worktree
        // state, otherwise reads and writes can inherit the parent's repo_id.
        return canonicalizeRepositoryRoot(dir);
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function currentContext(projectRoot: string): RepositoryContext {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  const workflowRoot = validateWorkflowBoundary(canonicalRoot);
  const identity = readRepositoryIdentity(canonicalRoot);
  return {
    repoId: identity?.repo_id ?? null,
    repoName: identity?.repo_name ?? basename(canonicalRoot),
    workspaceId: canonicalWorkspaceId(canonicalRoot),
    projectRoot: canonicalRoot,
    workflowRoot,
    authorityRoot: canonicalRoot,
    relation: 'current',
    alias: CURRENT_REPOSITORY_ALIAS,
    identityPersisted: Boolean(identity),
    read: [],
    write: [],
  };
}

export function inspectWorkspaceLink(projectRoot: string, link: WorkspaceLink): InspectedWorkspaceLink {
  const unresolved = resolve(projectRoot, link.path);
  try {
    if (link.name === CURRENT_REPOSITORY_ALIAS) {
      throw new Error('Linked repository alias "current" is reserved');
    }
    const resolvedPath = canonicalizeRepositoryRoot(unresolved);
    const workflowRoot = validateWorkflowBoundary(resolvedPath);
    const identity = readRepositoryIdentity(resolvedPath);
    if (link.repo_id && !identity) {
      throw new Error(`Linked repository identity is missing (expected ${link.repo_id})`);
    }
    if (link.repo_id && identity?.repo_id !== link.repo_id) {
      throw new Error(`Linked repository identity mismatch: cached ${link.repo_id}, found ${identity?.repo_id ?? 'none'}`);
    }
    return {
      resolvedPath,
      workflowRoot,
      valid: true,
      identityPersisted: Boolean(identity),
      repoId: identity?.repo_id ?? null,
      repoName: identity?.repo_name ?? basename(resolvedPath),
    };
  } catch (error) {
    return {
      resolvedPath: unresolved,
      workflowRoot: join(unresolved, '.workflow'),
      valid: false,
      identityPersisted: false,
      repoId: null,
      repoName: basename(unresolved),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readWorkspaceConfigDirect(projectRoot: string): WorkspaceConfig {
  const configPath = join(projectRoot, '.workflow', 'config.json');
  if (!existsSync(configPath)) return { linked: [] };
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { workspaces?: WorkspaceConfig };
    if (!raw.workspaces || !Array.isArray(raw.workspaces.linked)) return { linked: [] };
    return {
      linked: raw.workspaces.linked.map(link => ({
        ...link,
        share: Array.isArray(link.share) ? link.share : [],
        write: Array.isArray(link.write) ? link.write : [],
      })),
    };
  } catch {
    return { linked: [] };
  }
}

function linkedContext(projectRoot: string, link: WorkspaceLink): RepositoryContext {
  const inspected = inspectWorkspaceLink(projectRoot, link);
  if (!inspected.valid) throw new Error(`Linked repository "${link.name}" is invalid: ${inspected.error}`);
  return {
    repoId: inspected.repoId,
    repoName: inspected.repoName,
    workspaceId: canonicalWorkspaceId(inspected.resolvedPath),
    projectRoot: inspected.resolvedPath,
    workflowRoot: inspected.workflowRoot,
    authorityRoot: canonicalizeRepositoryRoot(projectRoot),
    relation: 'linked',
    alias: link.name,
    identityPersisted: inspected.identityPersisted,
    read: [...link.share],
    write: [...(link.write ?? [])],
  };
}

export interface ResolveRepositoryOptions {
  projectRoot?: string;
  config?: WorkspaceConfig;
  require?: { mode: 'read' | 'write'; corpus: WorkspaceCorpus };
}

/**
 * Resolve a repository selector in the fixed order: current, exact repo ID,
 * exact linked alias, then unique repository display name.
 */
export function resolveRepositoryContext(
  selector: string = CURRENT_REPOSITORY_ALIAS,
  options: ResolveRepositoryOptions = {},
): RepositoryContext {
  const start = options.projectRoot ?? process.env.MAESTRO_PROJECT_ROOT ?? process.cwd();
  const root = findRepositoryRoot(start) ?? canonicalizeRepositoryRoot(start);
  const current = currentContext(root);
  const config = options.config ?? readWorkspaceConfigDirect(root);

  const aliases = new Set<string>();
  for (const link of config.linked) {
    if (link.name === CURRENT_REPOSITORY_ALIAS) throw new Error('Linked repository alias "current" is reserved');
    if (aliases.has(link.name)) throw new Error(`Ambiguous linked repository alias: ${link.name}`);
    aliases.add(link.name);
  }

  const inspected = config.linked.map(link => ({ link, inspected: inspectWorkspaceLink(root, link) }));
  const advertisedIds = new Map<string, string>();
  if (current.repoId) advertisedIds.set(current.repoId, CURRENT_REPOSITORY_ALIAS);
  for (const item of inspected) {
    const repoId = item.inspected.valid ? item.inspected.repoId : null;
    if (!repoId) continue;
    const previous = advertisedIds.get(repoId);
    if (previous) {
      throw new Error(
        `Duplicate repository identity advertised by "${previous}" and "${item.link.name}": ${repoId}`,
      );
    }
    advertisedIds.set(repoId, item.link.name);
  }

  let context: RepositoryContext | undefined;
  if (selector === CURRENT_REPOSITORY_ALIAS) {
    context = current;
  } else if (current.repoId === selector) {
    context = current;
  } else {
    const idMatches = inspected.filter(item => item.inspected.valid && item.inspected.repoId === selector);
    if (idMatches.length > 1) throw new Error(`Ambiguous repository ID selector: ${selector}`);
    if (idMatches.length === 1) context = linkedContext(root, idMatches[0].link);

    if (!context) {
      const alias = config.linked.find(link => link.name === selector);
      if (alias) context = linkedContext(root, alias);
    }

    if (!context) {
      const nameMatches: RepositoryContext[] = [];
      if (current.repoName === selector) nameMatches.push(current);
      for (const item of inspected) {
        if (item.inspected.valid && item.inspected.repoName === selector) {
          nameMatches.push(linkedContext(root, item.link));
        }
      }
      if (nameMatches.length > 1) throw new Error(`Ambiguous repository name selector: ${selector}`);
      context = nameMatches[0];
    }
  }

  if (!context) throw new Error(`Repository selector not found: ${selector}`);
  if (options.require) assertRepositoryCapability(context, options.require.mode, options.require.corpus);
  return context;
}

export function assertRepositoryCapability(
  context: RepositoryContext,
  mode: 'read' | 'write',
  corpus: WorkspaceCorpus,
): void {
  if (context.relation === 'current') return;
  if (mode === 'write' && !context.read.includes(corpus)) {
    throw new Error(`Linked repository "${context.alias}" is not shared for ${corpus}`);
  }
  const capabilities = mode === 'read' ? context.read : context.write;
  if (!capabilities.includes(corpus)) {
    throw new Error(`Linked repository "${context.alias}" does not grant ${mode} capability for ${corpus}`);
  }
  if (mode === 'write' && !context.identityPersisted) {
    throw new Error(`Linked repository "${context.alias}" cannot be written without a persisted repository identity`);
  }
}

function toAgentBinding(context: RepositoryContext): AgentRepositoryBinding {
  return {
    repoId: context.repoId,
    repoName: context.repoName,
    projectRoot: context.projectRoot,
    relation: context.relation,
    alias: context.alias,
    identityPersisted: context.identityPersisted,
    readCapabilities: [...context.read],
    writeCapabilities: [...context.write],
  };
}

/** Resolve the immutable actor context passed to agent and MCP runtimes. */
export function resolveAgentRepositoryContext(
  projectRoot: string,
  options: { allowLegacyReadFallback?: boolean } = {},
): AgentRepositoryContext {
  try {
    const current = resolveRepositoryContext(CURRENT_REPOSITORY_ALIAS, { projectRoot });
    const config = readWorkspaceConfigDirect(current.projectRoot);
    const linkedRepositories: AgentRepositoryBinding[] = [];
    for (const link of config.linked) {
      try {
        linkedRepositories.push(toAgentBinding(linkedContext(current.projectRoot, link)));
      } catch {
        // Invalid/stale links are never advertised as authority to an agent.
      }
    }
    return {
      currentRepoId: current.repoId,
      currentRepoName: current.repoName,
      currentRepoRoot: current.projectRoot,
      currentProjectRoot: current.projectRoot,
      identityPersisted: current.identityPersisted,
      linkedRepositories,
    };
  } catch (error) {
    if (!options.allowLegacyReadFallback) throw error;
    const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
    return {
      currentRepoId: null,
      currentRepoName: basename(canonicalRoot),
      currentRepoRoot: canonicalRoot,
      currentProjectRoot: canonicalRoot,
      identityPersisted: false,
      linkedRepositories: [],
    };
  }
}

export function resolveAgentRepositoryTarget(
  actor: AgentRepositoryContext,
  targetRepoId: string | undefined,
  mode: 'read' | 'write',
  corpus: WorkspaceCorpus,
): AgentRepositoryBinding {
  const current: AgentRepositoryBinding = {
    repoId: actor.currentRepoId,
    repoName: actor.currentRepoName,
    projectRoot: actor.currentProjectRoot,
    relation: 'current',
    alias: CURRENT_REPOSITORY_ALIAS,
    identityPersisted: actor.identityPersisted,
    readCapabilities: [],
    writeCapabilities: [],
  };
  const target = !targetRepoId || targetRepoId === actor.currentRepoId
    ? current
    : actor.linkedRepositories.find(repository => repository.repoId === targetRepoId);
  if (!target) throw new Error(`Repository target is not available to this actor: ${targetRepoId}`);
  if (mode === 'write' && (!target.repoId || !target.identityPersisted)) {
    throw new Error('Repository mutation requires a persisted target repository identity');
  }
  if (target.relation === 'linked') {
    const capabilities = mode === 'read' ? target.readCapabilities : target.writeCapabilities;
    if (!capabilities.includes(corpus)) {
      throw new Error(`Linked repository "${target.alias}" does not grant ${mode} capability for ${corpus}`);
    }
  }
  return target;
}

interface ActiveRepositoryExecution {
  actor: AgentRepositoryContext;
  target: AgentRepositoryBinding;
}

const activeRepositoryExecution = new AsyncLocalStorage<ActiveRepositoryExecution>();

/** Re-read host config and manifests so a stale Agent/MCP snapshot cannot retain revoked authority. */
export function revalidateAgentRepositoryTarget(
  actor: AgentRepositoryContext,
  supplied: AgentRepositoryBinding,
  mode: 'read' | 'write',
  corpus: WorkspaceCorpus,
): AgentRepositoryBinding {
  const authority = resolveRepositoryContext(CURRENT_REPOSITORY_ALIAS, {
    projectRoot: actor.currentProjectRoot,
  });
  if (authority.repoId !== actor.currentRepoId
    || authority.identityPersisted !== actor.identityPersisted) {
    throw new Error('Actor repository identity changed after the host binding was captured');
  }
  if (!supplied.repoId) {
    if (mode === 'write') throw new Error('Repository mutation requires a persisted target repository identity');
    return supplied;
  }
  const fresh = resolveRepositoryId(supplied.repoId, {
    projectRoot: actor.currentProjectRoot,
    corpus,
    mode,
  });
  if (fresh.alias !== supplied.alias
    || fresh.relation !== supplied.relation
    || normalizedForComparison(fresh.projectRoot) !== normalizedForComparison(supplied.projectRoot)) {
    throw new Error('Repository target binding changed after the host context was captured');
  }
  return toAgentBinding(fresh);
}

export function runWithRepositoryExecution<T>(
  actor: AgentRepositoryContext,
  target: AgentRepositoryBinding,
  operation: () => T,
): T {
  return activeRepositoryExecution.run({ actor, target }, operation);
}

export function getActiveRepositoryExecution(): ActiveRepositoryExecution | undefined {
  return activeRepositoryExecution.getStore();
}

function assertSafeMutationPath(projectRoot: string, input: string): string {
  const canonicalRoot = canonicalizeRepositoryRoot(projectRoot);
  const target = resolve(input);
  if (!isPathContained(target, canonicalRoot)) {
    throw new Error(`Repository mutation path escapes target root: ${input}`);
  }
  const parts = relative(canonicalRoot, target).split(/[\\/]+/).filter(Boolean);
  let cursor = canonicalRoot;
  for (const part of parts) {
    const candidate = join(cursor, part);
    if (!existsSync(candidate)) {
      cursor = candidate;
      continue;
    }
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`Repository mutation path contains a symbolic link or junction: ${candidate}`);
    }
    const canonical = realpathSync(candidate);
    if (!isPathContained(canonical, canonicalRoot)) {
      throw new Error(`Repository mutation path escapes target root: ${candidate}`);
    }
    cursor = canonical;
  }
  return target;
}

export interface RepositoryMutationContext {
  projectRoot: string;
  repoId: string | null;
  /** Optional only for legacy in-repository writer call sites. */
  relation?: RepositoryRelation;
  alias?: string;
  authorityRoot?: string;
}

/**
 * Revalidate linked authority and target identity under deterministic source/target
 * locks immediately around a corpus mutation. Legacy links remain read-only.
 */
export function withRepositoryMutation<T>(
  supplied: RepositoryMutationContext,
  corpus: WorkspaceCorpus,
  targetPaths: readonly string[],
  operation: (validated: RepositoryContext) => T,
): T {
  if (!supplied.repoId) throw new Error('Repository mutation requires a persisted target repository identity');
  if (supplied.relation !== 'linked' || !supplied.alias || !supplied.authorityRoot) {
    throw new Error('Linked repository mutation requires a complete host-resolved authority context');
  }
  const authorityRoot = canonicalizeRepositoryRoot(supplied.authorityRoot);
  const targetRoot = canonicalizeRepositoryRoot(supplied.projectRoot);
  const configPath = join(authorityRoot, '.workflow', 'config.json');
  const authorityManifest = join(authorityRoot, REPOSITORY_IDENTITY_PATH);
  const targetManifest = join(targetRoot, REPOSITORY_IDENTITY_PATH);
  const safeTargets = targetPaths.map(path => assertSafeMutationPath(targetRoot, path));
  const release = acquireFileLocksSync([
    configPath,
    authorityManifest,
    targetManifest,
    knowledgeCorpusNamespaceTarget(targetRoot),
    ...safeTargets,
  ]);
  try {
    const validate = (): RepositoryContext => {
      const authority = resolveRepositoryContext(CURRENT_REPOSITORY_ALIAS, { projectRoot: authorityRoot });
      if (!authority.repoId || !authority.identityPersisted) {
        throw new Error('Repository mutation requires a persisted actor repository identity');
      }
      const current = resolveRepositoryId(supplied.repoId!, {
        projectRoot: authorityRoot,
        corpus,
        mode: 'write',
      });
      if (current.relation !== supplied.relation
        || current.alias !== supplied.alias
        || normalizedForComparison(current.projectRoot) !== normalizedForComparison(targetRoot)) {
        throw new Error('Repository target authority changed before mutation');
      }
      for (const path of safeTargets) assertSafeMutationPath(current.projectRoot, path);
      return current;
    };
    const validated = validate();
    const result = operation(validated);
    validate();
    return result;
  } finally {
    release();
  }
}

export interface ResolveRepositorySelectorsOptions {
  projectRoot?: string;
  config?: WorkspaceConfig;
  corpus?: WorkspaceCorpus;
  mode?: 'read' | 'write';
}

/** Resolve human-facing selectors and return only persisted corpus-safe IDs. */
export function resolveRepositorySelectorIds(
  selectors: readonly string[],
  options: ResolveRepositorySelectorsOptions = {},
): string[] {
  const ids: string[] = [];
  for (const selector of selectors) {
    const context = resolveRepositoryContext(selector, {
      projectRoot: options.projectRoot,
      config: options.config,
      require: options.corpus
        ? { mode: options.mode ?? 'read', corpus: options.corpus }
        : undefined,
    });
    if (!context.repoId) {
      throw new Error(`Repository selector has no persisted repository identity: ${selector}`);
    }
    if (!ids.includes(context.repoId)) ids.push(context.repoId);
  }
  return ids;
}

/**
 * Resolve an ID-only tool contract. Aliases and display names deliberately fail
 * even when they would otherwise resolve, preventing non-canonical values from
 * leaking into corpus metadata.
 */
export function resolveRepositoryId(
  repoId: string,
  options: ResolveRepositorySelectorsOptions = {},
): RepositoryContext {
  const context = resolveRepositoryContext(repoId, {
    projectRoot: options.projectRoot,
    config: options.config,
    require: options.corpus
      ? { mode: options.mode ?? 'read', corpus: options.corpus }
      : undefined,
  });
  if (!context.repoId || context.repoId !== repoId) {
    throw new Error(`Repository value must be an exact persisted repository ID: ${repoId}`);
  }
  return context;
}
