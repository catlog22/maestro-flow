import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  getKnowhowDir,
  knowhowFileToWikiId,
  parseFrontmatter,
} from '../utils/frontmatter.js';
import { acquireKnowledgeCorpusNamespaceLockSync } from '../utils/atomic-write.js';
import {
  withRepositoryMutation,
  type RepositoryMutationContext,
} from '../repository/context.js';
import {
  acquireLifecycleLockBound,
  compareReleaseLifecycleLock,
  LifecycleFsHelperError,
  quarantineLifecycleFileBound,
  readLifecycleFileBound,
  recoverLifecycleQuarantineBound,
  replaceLifecycleFileBound,
  withVerifiedLifecycleFsHelper,
} from '../utils/lifecycle-fs-helper.js';
import type {
  BoundLock,
  BoundQuarantine,
  BoundRead,
} from '../utils/lifecycle-fs-wire.js';

const LIFECYCLE_LOCK = '.lifecycle.lock';
const LIFECYCLE_INTENT = '.lifecycle.intent.json';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

type ContentHash = string | null;

export interface KnowhowLifecycleResult {
  success: boolean;
  schema_version?: 'knowhow-supersede-result/1.0';
  operation?: 'supersede';
  oldId?: string;
  newId?: string;
  replayed?: boolean;
  error?: string;
  code?: string;
}

export interface KnowhowEvolutionLink {
  id: string;
  filename: string;
  path: string;
  title: string;
  deprecated: boolean;
  current: boolean;
  broken: boolean;
  supersedes: string[];
  supersededBy: string | null;
}

export interface LifecycleFaultOptions {
  ownerGeneration?: string;
  /** Host-resolved authority for an explicitly linked lifecycle target. */
  repositoryContext?: RepositoryMutationContext;
  /** Internal recursion fence set only while authority locks are held. */
  authorityValidated?: boolean;
  afterTarget?: (path: string, completedTargets: number) => void;
  beforeTargetCheckpoint?: (path: string, completedTargets: number) => void;
  afterTargetQuarantine?: (
    path: string,
    quarantine: BoundQuarantine,
  ) => void;
  beforeLockDelete?: (
    phase: 'reclaim' | 'release',
    lockPath: string,
  ) => void;
}

interface KnowhowNode {
  id: string;
  filename: string;
  filePath: string;
  relativePath: string;
  raw: string;
  data: Record<string, unknown>;
}

interface LifecycleIntentTarget {
  id: string;
  path: string;
  beforeHash: ContentHash;
  afterHash: ContentHash;
  beforeBase64: string | null;
  afterBase64: string | null;
}

export interface LifecycleIntent {
  schema_version: 'knowhow-lifecycle-intent/1.0';
  operation: 'supersede';
  oldId: string;
  newId: string;
  targets: LifecycleIntentTarget[];
}

export interface KnowhowSnapshotTarget {
  path: string;
  beforeHash: ContentHash;
  beforeBase64: string | null;
  afterHash: ContentHash;
  expectedAbsent: boolean;
}

export interface KnowhowLifecycleSnapshot {
  schema_version: 'knowhow-lifecycle-snapshot/1.0';
  createdAt: string;
  sealedAt: string | null;
  oldId: string;
  newId: string;
  targets: KnowhowSnapshotTarget[];
}

export interface CreateKnowhowSnapshotOptions {
  oldId: string;
  newId: string;
  newPath: string;
  includeRelative?: string[];
  out: string;
}

export interface RestoreTargetState {
  path: string;
  beforeHash: ContentHash;
  afterHash: ContentHash;
  restoreHash: ContentHash;
  completed: boolean;
  quarantine?: BoundQuarantine;
}

export interface KnowhowRestoreIntent {
  schema_version: 'knowhow-restore-intent/1.0';
  requestId: string;
  operation: 'restore';
  status: 'pending' | 'completed' | 'conflict';
  subject: string;
  claimedRun: string;
  requestHash: string;
  targets: RestoreTargetState[];
  conflict?: {
    path: string;
    expectedHash: ContentHash;
    actualHash: ContentHash;
  };
}

export interface KnowhowRestoreReceipt {
  schema_version: 'knowhow-restore-receipt/1.0';
  requestId: string;
  operation: 'restore';
  status: 'completed' | 'conflict';
  subject: string;
  claimedRun: string;
  requestHash: string;
  resultHash: string;
  targets: RestoreTargetState[];
  conflict?: {
    path: string;
    expectedHash: ContentHash;
    actualHash: ContentHash;
  };
}

export interface RestoreKnowhowOptions extends LifecycleFaultOptions {
  claimedRun?: string;
}

export interface RestoreKnowhowResult {
  success: boolean;
  replayed: boolean;
  intent: KnowhowRestoreIntent;
  receipt?: KnowhowRestoreReceipt;
  error?: string;
  code?: string;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type LifecyclePathExpectation =
  | 'existing-file'
  | 'existing-directory'
  | 'write-target'
  | 'delete-target';

function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isContainedPath(canonicalRoot: string, candidate: string): boolean {
  const root = comparablePath(canonicalRoot);
  const target = comparablePath(candidate);
  return target === root || target.startsWith(`${root}/`);
}

function unsafeLifecyclePath(input: string, reason: string): Error {
  return new Error(`Unsafe knowhow lifecycle path: ${input} (${reason})`);
}

export function resolveLifecyclePath(
  projectRoot: string,
  input: string,
  expected: LifecyclePathExpectation,
): string {
  const canonicalRoot = realpathSync.native(projectRoot);
  const normalizedInput = input.replaceAll('\\', sep);
  const lexicalTarget = isAbsolute(normalizedInput)
    ? resolve(normalizedInput)
    : resolve(canonicalRoot, normalizedInput);
  if (!isContainedPath(canonicalRoot, lexicalTarget)) {
    throw unsafeLifecyclePath(input, 'outside canonical project root');
  }

  const relativeTarget = relative(canonicalRoot, lexicalTarget);
  const components = relativeTarget
    .split(/[\\/]+/)
    .filter(component => component.length > 0 && component !== '.');
  let canonicalParent = canonicalRoot;
  let finalStat = lstatSync(canonicalRoot);

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const candidate = join(canonicalParent, component);
    try {
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw unsafeLifecyclePath(input, `symbolic link or junction component: ${component}`);
      }
      if (!stat.isFile() && !stat.isDirectory()) {
        throw unsafeLifecyclePath(input, `unsupported filesystem component: ${component}`);
      }
      const canonical = realpathSync.native(candidate);
      const expectedCanonical = join(canonicalParent, component);
      if (comparablePath(canonical) !== comparablePath(expectedCanonical)
        || !isContainedPath(canonicalRoot, canonical)) {
        throw unsafeLifecyclePath(input, `reparse point or containment mismatch: ${component}`);
      }
      canonicalParent = canonical;
      finalStat = stat;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (expected === 'existing-file' || expected === 'existing-directory') {
        throw unsafeLifecyclePath(input, 'required path does not exist');
      }
      const unresolved = resolve(canonicalParent, ...components.slice(index));
      if (!isContainedPath(canonicalRoot, unresolved)) {
        throw unsafeLifecyclePath(input, 'nearest existing parent escapes canonical project root');
      }
      return unresolved;
    }
  }

  if (expected === 'existing-file' && !finalStat.isFile()) {
    throw unsafeLifecyclePath(input, 'expected a regular file');
  }
  if (expected === 'existing-directory' && !finalStat.isDirectory()) {
    throw unsafeLifecyclePath(input, 'expected a directory');
  }
  return canonicalParent;
}

function ensureLifecycleDirectory(projectRoot: string, input: string): string {
  const path = resolveLifecyclePath(projectRoot, input, 'write-target');
  mkdirSync(path, { recursive: true });
  return resolveLifecyclePath(projectRoot, path, 'existing-directory');
}

interface LifecycleBoundRead extends BoundRead {
  bytes: Buffer;
}

interface LifecycleLockOwnerView {
  pid: number;
}

function lifecycleRelativePath(projectRoot: string, input: string): string {
  const root = resolve(projectRoot);
  const normalizedInput = input.replaceAll('\\', sep);
  const absolute = isAbsolute(normalizedInput)
    ? resolve(normalizedInput)
    : resolve(root, normalizedInput);
  if (!isContainedPath(root, absolute)) {
    throw unsafeLifecyclePath(input, 'outside project root');
  }
  const output = relative(root, absolute).replaceAll('\\', '/');
  if (!output || output === '.' || output.startsWith('../')) {
    throw unsafeLifecyclePath(input, 'path must name a project file');
  }
  return output;
}

function isLifecycleFsError(
  error: unknown,
  ...codes: LifecycleFsHelperError['code'][]
): error is LifecycleFsHelperError {
  return error instanceof LifecycleFsHelperError && codes.includes(error.code);
}

function readLifecycleBoundOptional(
  projectRoot: string,
  input: string,
): LifecycleBoundRead | null {
  try {
    const bound = readLifecycleFileBound(
      projectRoot,
      lifecycleRelativePath(projectRoot, input),
    );
    return {
      ...bound,
      bytes: Buffer.from(bound.bytesBase64, 'base64'),
    };
  } catch (error) {
    if (isLifecycleFsError(error, 'MISSING')) return null;
    throw error;
  }
}

function sameLifecycleBoundRead(
  left: LifecycleBoundRead,
  right: LifecycleBoundRead,
): boolean {
  return left.bytes.equals(right.bytes)
    && stableJson(left.generation) === stableJson(right.generation);
}

function parseLifecycleLockOwner(bytes: Buffer): LifecycleLockOwnerView | null {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(',');
    const canonical = keys === 'ownerGeneration,pid,token'
      && typeof value.ownerGeneration === 'string'
      && value.ownerGeneration.length > 0
      && typeof value.token === 'string'
      && value.token.length > 0;
    const lifecycleLegacy = keys === 'acquiredAt,pid,schema_version,token'
      && value.schema_version === 'knowhow-lifecycle-lock/1.0'
      && Number.isInteger(value.acquiredAt)
      && (value.acquiredAt as number) >= 0
      && typeof value.token === 'string'
      && value.token.length > 0;
    const atomicWriterLegacy = keys === 'createdAt,pid'
      && Number.isInteger(value.createdAt)
      && (value.createdAt as number) >= 0;
    if ((!canonical && !lifecycleLegacy && !atomicWriterLegacy)
      || !Number.isInteger(value.pid)
      || (value.pid as number) <= 0) {
      return null;
    }
    return { pid: value.pid as number };
  } catch {
    return null;
  }
}

function lifecycleOwnerLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
  }
}

function withLifecyclePathLock<T>(
  projectRoot: string,
  lockPathInput: string,
  action: (lock: BoundLock) => T,
  options?: LifecycleFaultOptions,
): T {
  return withVerifiedLifecycleFsHelper(
    () => withLifecyclePathLockVerified(projectRoot, lockPathInput, action, options),
  );
}

function withLifecyclePathLockVerified<T>(
  projectRoot: string,
  lockPathInput: string,
  action: (lock: BoundLock) => T,
  options?: LifecycleFaultOptions,
): T {
  const lockRelativePath = lifecycleRelativePath(projectRoot, lockPathInput);
  const lockPath = resolve(projectRoot, lockRelativePath.replaceAll('/', sep));
  ensureLifecycleDirectory(projectRoot, dirname(lockPath));
  const startedAt = Date.now();
  const owner = {
    pid: process.pid,
    token: randomUUID(),
    ownerGeneration: options?.ownerGeneration ?? randomUUID(),
  };
  let lock: BoundLock | null = null;
  let busyError: LifecycleFsHelperError | null = null;
  while (lock === null) {
    try {
      lock = acquireLifecycleLockBound(
        projectRoot,
        lockRelativePath,
        owner,
        LOCK_TIMEOUT_MS,
      );
      break;
    } catch (error) {
      if (!isLifecycleFsError(error, 'BUSY')) throw error;
      busyError = error;
      const observed = readLifecycleBoundOptional(projectRoot, lockRelativePath);
      const observedOwner = observed ? parseLifecycleLockOwner(observed.bytes) : null;
      if (observed && observedOwner) {
        const liveness = lifecycleOwnerLiveness(observedOwner.pid);
        if (liveness === 'dead') {
          options?.beforeLockDelete?.('reclaim', lockPath);
          const verified = readLifecycleBoundOptional(projectRoot, lockRelativePath);
          if (verified && sameLifecycleBoundRead(observed, verified)) {
            try {
              const quarantine = quarantineLifecycleFileBound(
                projectRoot,
                lockRelativePath,
                verified.generation.sha256,
                `lock-reclaim_${randomUUID()}`,
                randomUUID(),
              );
              const recovered = recoverLifecycleQuarantineBound(
                projectRoot,
                quarantine,
                'commit',
              );
              if (recovered === 'committed') continue;
              if (recovered === 'replaced') continue;
              throw new Error(`Unexpected stale lock recovery result: ${recovered}`);
            } catch (reclaimError) {
              if (isLifecycleFsError(reclaimError, 'MISSING', 'REPLACED')) {
                continue;
              }
              throw reclaimError;
            }
          }
        }
        if (liveness !== 'dead') throw busyError;
      }
      if (observed && !observedOwner) throw busyError;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw busyError;
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }

  let result: T | undefined;
  let actionError: unknown;
  try {
    result = action(lock);
  } catch (error) {
    actionError = error;
  }

  let releaseError: unknown;
  try {
    options?.beforeLockDelete?.('release', lockPath);
    const release = compareReleaseLifecycleLock(projectRoot, lock);
    if (release !== 'released' && release !== 'missing' && release !== 'replaced') {
      throw new Error(`Unexpected lifecycle lock release result: ${release}`);
    }
  } catch (error) {
    releaseError = error;
  }

  if (actionError !== undefined && releaseError !== undefined) {
    throw new AggregateError(
      [actionError, releaseError],
      'Lifecycle action and exact lock release both failed',
    );
  }
  if (actionError !== undefined) throw actionError;
  if (releaseError !== undefined) throw releaseError;
  return result as T;
}

function withLifecycleLock<T>(
  projectRoot: string,
  action: () => T,
  options?: LifecycleFaultOptions,
): T {
  const knowhowDir = join(getKnowhowDir(projectRoot));
  return withVerifiedLifecycleFsHelper(() => {
    const releaseCorpusNamespace = acquireKnowledgeCorpusNamespaceLockSync(projectRoot);
    try {
      return withLifecyclePathLockVerified(
        projectRoot,
        join(knowhowDir, LIFECYCLE_LOCK),
        action,
        options,
      );
    } finally {
      releaseCorpusNamespace();
    }
  });
}

function withTargetWriterLock<T>(
  projectRoot: string,
  targetInput: string,
  action: (lock: BoundLock) => T,
): T {
  const targetRelativePath = lifecycleRelativePath(projectRoot, targetInput);
  return withLifecyclePathLock(
    projectRoot,
    `${targetRelativePath}.lock`,
    action,
  );
}

function writeLifecycleBytesExact(
  projectRoot: string,
  pathInput: string,
  bytes: Buffer,
  expectedHash: ContentHash | undefined,
): void {
  const relativePath = lifecycleRelativePath(projectRoot, pathInput);
  const current = readLifecycleBoundOptional(projectRoot, relativePath);
  const currentHash = current ? sha256(current.bytes) : null;
  if (expectedHash !== undefined && currentHash !== expectedHash) {
    throw new Error(`Concurrent modification detected: ${relativePath}`);
  }
  if (current?.bytes.equals(bytes)) return;
  replaceLifecycleFileBound(
    projectRoot,
    relativePath,
    bytes,
    current?.generation ?? null,
    randomUUID(),
  );
}

function removeLifecycleFile(projectRoot: string, input: string): void {
  const relativePath = lifecycleRelativePath(projectRoot, input);
  withTargetWriterLock(projectRoot, relativePath, writerLock => {
    const current = readLifecycleBoundOptional(projectRoot, relativePath);
    if (!current) return;
    const quarantine = quarantineLifecycleFileBound(
      projectRoot,
      relativePath,
      current.generation.sha256,
      `delete_${randomUUID()}`,
      writerLock.ownerGeneration,
    );
    const recovered = recoverLifecycleQuarantineBound(projectRoot, quarantine, 'commit');
    if (recovered !== 'committed') {
      throw new Error(`Lifecycle delete lost exact quarantine: ${relativePath}`);
    }
  });
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function hashFile(projectRoot: string, input: string): ContentHash {
  const read = readLifecycleBoundOptional(projectRoot, input);
  return read ? sha256(read.bytes) : null;
}

function relativePath(projectRoot: string, path: string): string {
  return lifecycleRelativePath(projectRoot, path);
}

function writeJsonAtomic(projectRoot: string, pathInput: string, value: unknown): void {
  const document = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  writeLifecycleBytesExact(projectRoot, pathInput, document, undefined);
}

function readJson<T>(projectRoot: string, pathInput: string): T {
  const read = readLifecycleBoundOptional(projectRoot, pathInput);
  if (!read) throw new Error(`Lifecycle JSON file is missing: ${pathInput}`);
  return parseLifecycleJson<T>(read);
}

function parseLifecycleJson<T>(read: LifecycleBoundRead): T {
  return JSON.parse(read.bytes.toString('utf8')) as T;
}

function listMarkdownFiles(projectRoot: string, dirInput: string): string[] {
  const candidate = resolveLifecyclePath(projectRoot, dirInput, 'delete-target');
  if (!existsSync(candidate)) return [];
  const dir = resolveLifecyclePath(projectRoot, candidate, 'existing-directory');
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      resolveLifecyclePath(projectRoot, path, 'existing-directory');
      out.push(...listMarkdownFiles(projectRoot, path));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(resolveLifecyclePath(projectRoot, path, 'existing-file'));
    } else if (entry.isSymbolicLink()) {
      throw unsafeLifecyclePath(path, 'symbolic link or junction in knowhow scan');
    }
  }
  resolveLifecyclePath(projectRoot, dir, 'existing-directory');
  return out.sort();
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(values.map(String).map(item => item.trim()).filter(Boolean))];
}

function scanKnowhow(projectRoot: string): Map<string, KnowhowNode> {
  const byId = new Map<string, KnowhowNode>();
  for (const filePath of listMarkdownFiles(projectRoot, getKnowhowDir(projectRoot))) {
    const filename = basename(filePath);
    const id = knowhowFileToWikiId(filename);
    if (byId.has(id)) throw new Error(`Duplicate knowhow id: ${id}`);
    const relativeFilePath = lifecycleRelativePath(projectRoot, filePath);
    const bound = readLifecycleBoundOptional(projectRoot, relativeFilePath);
    if (!bound) {
      throw new Error(`Knowhow file disappeared during bound scan: ${relativeFilePath}`);
    }
    const raw = bound.bytes.toString('utf8');
    const safeFilePath = resolve(projectRoot, relativeFilePath.replaceAll('/', sep));
    const { data } = parseFrontmatter(raw);
    byId.set(id, {
      id,
      filename,
      filePath: safeFilePath,
      relativePath: relativeFilePath,
      raw,
      data,
    });
  }
  return byId;
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

export function setFrontmatterValues(
  raw: string,
  values: Record<string, string | string[]>,
): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') throw new Error('Knowhow entry is missing YAML frontmatter');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('Knowhow entry has unterminated YAML frontmatter');

  for (const [key, value] of Object.entries(values)) {
    const next = Array.isArray(value)
      ? `${key}: ${JSON.stringify(value)}`
      : `${key}: ${yamlValue(value)}`;
    const index = lines.findIndex((line, lineIndex) => (
      lineIndex > 0
      && lineIndex < end
      && line.match(/^([^:#]+):/)?.[1].trim() === key
    ));
    if (index >= 0) lines[index] = next;
    else {
      lines.splice(end, 0, next);
    }
  }
  return lines.join('\n');
}

function successorMap(nodes: Map<string, KnowhowNode>): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of nodes.values()) {
    const direct = typeof node.data.supersededBy === 'string' ? node.data.supersededBy : undefined;
    if (direct) out.set(node.id, direct);
    for (const predecessor of stringList(node.data.supersedes)) {
      const existing = out.get(predecessor);
      if (existing && existing !== node.id) {
        throw new Error(`${predecessor} has conflicting successors: ${existing}, ${node.id}`);
      }
      out.set(predecessor, node.id);
    }
  }
  return out;
}

function wouldCreateCycle(successors: Map<string, string>, oldId: string, newId: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = newId;
  while (current && !seen.has(current)) {
    if (current === oldId) return true;
    seen.add(current);
    current = successors.get(current);
  }
  return false;
}

function lifecycleIntentPath(projectRoot: string): string {
  return join(getKnowhowDir(projectRoot), LIFECYCLE_INTENT);
}

export function assertLifecycleIntent(
  projectRoot: string,
  value: LifecycleIntent,
): void {
  if (value.schema_version !== 'knowhow-lifecycle-intent/1.0'
    || value.operation !== 'supersede'
    || typeof value.oldId !== 'string'
    || typeof value.newId !== 'string'
    || value.oldId === value.newId
    || !Array.isArray(value.targets)
    || value.targets.length !== 2) {
    throw new Error('Invalid knowhow lifecycle intent');
  }

  const nodes = scanKnowhow(projectRoot);
  const oldNode = nodes.get(value.oldId);
  const newNode = nodes.get(value.newId);
  if (!oldNode || !newNode) {
    throw new Error('Lifecycle intent ids do not resolve to canonical knowhow files');
  }
  const expectedNodes = new Map([
    [value.oldId, oldNode],
    [value.newId, newNode],
  ]);
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const target of value.targets) {
    if (!target.path || !target.id || !('beforeHash' in target) || !('afterHash' in target)) {
      throw new Error('Invalid knowhow lifecycle intent target');
    }
    if (target.beforeBase64 === null || target.afterBase64 === null) {
      throw new Error(`Lifecycle supersede target must preserve a knowhow file: ${target.path}`);
    }
    const before = Buffer.from(target.beforeBase64, 'base64');
    const after = Buffer.from(target.afterBase64, 'base64');
    if (sha256(before) !== target.beforeHash) {
      throw new Error(`Lifecycle intent before hash is invalid: ${target.path}`);
    }
    if (sha256(after) !== target.afterHash) {
      throw new Error(`Lifecycle intent after hash is invalid: ${target.path}`);
    }

    const expectedNode = expectedNodes.get(target.id);
    if (!expectedNode || seenIds.has(target.id)) {
      throw new Error(`Lifecycle intent target id is not bound to the supersede pair: ${target.id}`);
    }
    const canonicalTarget = lifecycleRelativePath(projectRoot, target.path);
    const canonicalExpected = lifecycleRelativePath(projectRoot, expectedNode.filePath);
    if (canonicalTarget !== canonicalExpected || seenPaths.has(canonicalTarget)) {
      throw new Error(`Lifecycle intent target path is not canonical for ${target.id}: ${target.path}`);
    }

    const beforeRaw = before.toString('utf8');
    const expectedAfter = target.id === value.oldId
      ? setFrontmatterValues(beforeRaw, {
        status: 'deprecated',
        supersededBy: value.newId,
      })
      : setFrontmatterValues(beforeRaw, {
        supersedes: [...new Set([
          ...stringList(parseFrontmatter(beforeRaw).data.supersedes),
          value.oldId,
        ])].sort(),
      });
    if (!after.equals(Buffer.from(expectedAfter, 'utf8'))) {
      throw new Error(`Lifecycle intent after bytes exceed the allowed supersede transform: ${target.path}`);
    }
    seenIds.add(target.id);
    seenPaths.add(canonicalTarget);
  }
  if (seenIds.size !== expectedNodes.size) {
    throw new Error('Lifecycle intent targets do not exactly match oldId/newId');
  }
}

function writeTarget(
  projectRoot: string,
  target: LifecycleIntentTarget,
  expectedHash: ContentHash,
  contentBase64: string | null,
): void {
  if (contentBase64 === null) {
    if (hashFile(projectRoot, target.path) !== expectedHash) {
      throw new Error(`Concurrent modification detected: ${target.path}`);
    }
    removeLifecycleFile(projectRoot, target.path);
    return;
  }
  writeLifecycleBytesExact(
    projectRoot,
    target.path,
    Buffer.from(contentBase64, 'base64'),
    expectedHash,
  );
}

function recoverLifecycleUnlocked(projectRoot: string, options?: LifecycleFaultOptions): boolean {
  const intentPath = lifecycleIntentPath(projectRoot);
  const intentRead = readLifecycleBoundOptional(projectRoot, intentPath);
  if (!intentRead) return false;
  const intent = parseLifecycleJson<LifecycleIntent>(intentRead);
  assertLifecycleIntent(projectRoot, intent);
  let completed = 0;
  for (const target of [...intent.targets].sort((left, right) => left.id.localeCompare(right.id))) {
    const currentHash = hashFile(projectRoot, target.path);
    if (currentHash === target.afterHash) {
      completed++;
      continue;
    }
    if (currentHash !== target.beforeHash) {
      throw new Error(
        `KNOWHOW_LIFECYCLE_CONFLICT: ${target.path} expected ${target.beforeHash} or ${target.afterHash}, got ${currentHash}`,
      );
    }
    writeTarget(projectRoot, target, target.beforeHash, target.afterBase64);
    completed++;
    options?.afterTarget?.(target.path, completed);
  }
  removeLifecycleFile(projectRoot, intentPath);
  return true;
}

function assertHistoryRecoveryNotRequired(projectRoot: string): void {
  const intentPath = lifecycleIntentPath(projectRoot);
  if (readLifecycleBoundOptional(projectRoot, intentPath)) {
    throw new Error(
      `KNOWHOW_LIFECYCLE_RECOVERY_REQUIRED: run "maestro knowhow recover" before reading history`,
    );
  }
}

export function recoverKnowhowLifecycleIntent(
  projectRoot: string,
  options?: LifecycleFaultOptions,
): KnowhowLifecycleResult {
  try {
    if (options?.repositoryContext?.relation === 'linked' && !options.authorityValidated) {
      return withRepositoryMutation(options.repositoryContext, 'knowhow', [], () => (
        recoverKnowhowLifecycleIntent(projectRoot, { ...options, authorityValidated: true })
      ));
    }
    const replayed = withLifecycleLock(
      projectRoot,
      () => recoverLifecycleUnlocked(projectRoot, options),
      options,
    );
    return { success: true, replayed };
  } catch (error) {
    return {
      success: false,
      code: 'KNOWHOW_LIFECYCLE_CONFLICT',
      error: (error as Error).message,
    };
  }
}

export function supersedeKnowhowEntry(
  projectRoot: string,
  oldId: string,
  newId: string,
  options?: LifecycleFaultOptions,
): KnowhowLifecycleResult {
  try {
    if (options?.repositoryContext?.relation === 'linked' && !options.authorityValidated) {
      return withRepositoryMutation(options.repositoryContext, 'knowhow', [], () => (
        supersedeKnowhowEntry(projectRoot, oldId, newId, { ...options, authorityValidated: true })
      ));
    }
    return withLifecycleLock(projectRoot, () => {
      recoverLifecycleUnlocked(projectRoot);
      if (oldId === newId) throw new Error(`Cannot supersede a knowhow id with itself: ${oldId}`);

      const nodes = scanKnowhow(projectRoot);
      const oldNode = nodes.get(oldId);
      const newNode = nodes.get(newId);
      if (!oldNode) throw new Error(`Knowhow id not found: ${oldId}`);
      if (!newNode) throw new Error(`Knowhow id not found: ${newId}`);

      const successors = successorMap(nodes);
      const existingSuccessor = successors.get(oldId);
      if (existingSuccessor && existingSuccessor !== newId) {
        throw new Error(`${oldId} is already superseded by ${existingSuccessor}`);
      }
      if (wouldCreateCycle(successors, oldId, newId)) {
        throw new Error(`Superseding ${oldId} by ${newId} would create a cycle`);
      }

      const newPredecessors = stringList(newNode.data.supersedes);
      const completePair = existingSuccessor === newId
        && newPredecessors.includes(oldId)
        && oldNode.data.status === 'deprecated'
        && oldNode.data.supersededBy === newId;
      if (completePair) {
        return {
          success: true,
          schema_version: 'knowhow-supersede-result/1.0',
          operation: 'supersede',
          oldId,
          newId,
          replayed: true,
        };
      }

      const oldAfter = setFrontmatterValues(oldNode.raw, {
        status: 'deprecated',
        supersededBy: newId,
      });
      const newAfter = setFrontmatterValues(newNode.raw, {
        supersedes: [...new Set([...newPredecessors, oldId])].sort(),
      });
      const targetDocuments = [
        { node: oldNode, after: oldAfter },
        { node: newNode, after: newAfter },
      ].sort((left, right) => left.node.id.localeCompare(right.node.id));
      const intent: LifecycleIntent = {
        schema_version: 'knowhow-lifecycle-intent/1.0',
        operation: 'supersede',
        oldId,
        newId,
        targets: targetDocuments.map(({ node, after }) => ({
          id: node.id,
          path: node.relativePath,
          beforeHash: sha256(Buffer.from(node.raw, 'utf8')),
          afterHash: sha256(Buffer.from(after, 'utf8')),
          beforeBase64: Buffer.from(node.raw, 'utf8').toString('base64'),
          afterBase64: Buffer.from(after, 'utf8').toString('base64'),
        })),
      };
      writeJsonAtomic(projectRoot, lifecycleIntentPath(projectRoot), intent);
      let completed = 0;
      for (const target of intent.targets) {
        writeTarget(projectRoot, target, target.beforeHash, target.afterBase64);
        completed++;
        options?.afterTarget?.(target.path, completed);
      }
      removeLifecycleFile(projectRoot, lifecycleIntentPath(projectRoot));
      return {
        success: true,
        schema_version: 'knowhow-supersede-result/1.0',
        operation: 'supersede',
        oldId,
        newId,
        replayed: false,
      };
    }, options);
  } catch (error) {
    return {
      success: false,
      code: 'KNOWHOW_LIFECYCLE_CONFLICT',
      error: (error as Error).message,
    };
  }
}

export function getKnowhowEvolutionChain(
  projectRoot: string,
  id: string,
): KnowhowEvolutionLink[] {
  return withVerifiedLifecycleFsHelper(
    () => getKnowhowEvolutionChainBound(projectRoot, id),
  );
}

function getKnowhowEvolutionChainBound(
  projectRoot: string,
  id: string,
): KnowhowEvolutionLink[] {
  assertHistoryRecoveryNotRequired(projectRoot);
  const nodes = scanKnowhow(projectRoot);
  assertHistoryRecoveryNotRequired(projectRoot);
  if (!nodes.has(id)) return [];
  const successors = successorMap(nodes);
  const predecessors = new Map<string, string[]>();
  for (const [oldId, newId] of successors) {
    const values = predecessors.get(newId) ?? [];
    values.push(oldId);
    predecessors.set(newId, values.sort());
  }

  let root = id;
  const backwardGuard = new Set<string>();
  while (!backwardGuard.has(root)) {
    backwardGuard.add(root);
    const previous = predecessors.get(root)?.find(candidate => nodes.has(candidate));
    if (!previous) break;
    root = previous;
  }

  const chain: KnowhowEvolutionLink[] = [];
  const forwardGuard = new Set<string>();
  let current: string | undefined = root;
  while (current && nodes.has(current) && !forwardGuard.has(current)) {
    forwardGuard.add(current);
    const node = nodes.get(current)!;
    const successor: string | null = successors.get(current) ?? null;
    const deprecated = node.data.status === 'deprecated';
    chain.push({
      id: current,
      filename: node.filename,
      path: node.relativePath.replace(/^\.workflow\//, ''),
      title: typeof node.data.title === 'string' ? node.data.title : 'Untitled',
      deprecated,
      current: false,
      broken: successor !== null && !nodes.has(successor),
      supersedes: stringList(node.data.supersedes),
      supersededBy: successor,
    });
    current = successor ?? undefined;
  }
  if (chain.length > 0) {
    const tail = chain[chain.length - 1];
    if (!tail.deprecated && !tail.broken) tail.current = true;
    else if (tail.deprecated && !tail.supersededBy) tail.broken = true;
  }
  return chain;
}

function resolveSnapshotPath(
  projectRoot: string,
  path: string,
  expected: LifecyclePathExpectation,
): string {
  return resolveLifecyclePath(projectRoot, path, expected);
}

function resolveSnapshotTargetInput(projectRoot: string, path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('knowhow/')
    ? resolveLifecyclePath(projectRoot, join('.workflow', normalized), 'delete-target')
    : resolveLifecyclePath(projectRoot, path, 'delete-target');
}

function captureSnapshotTarget(projectRoot: string, path: string): KnowhowSnapshotTarget {
  const relativeTarget = lifecycleRelativePath(projectRoot, path);
  const bound = readLifecycleBoundOptional(projectRoot, relativeTarget);
  const content = bound?.bytes ?? null;
  return {
    path: relativeTarget,
    beforeHash: content ? sha256(content) : null,
    beforeBase64: content?.toString('base64') ?? null,
    afterHash: null,
    expectedAbsent: bound === null,
  };
}

function assertSnapshot(snapshot: KnowhowLifecycleSnapshot): void {
  if (snapshot.schema_version !== 'knowhow-lifecycle-snapshot/1.0'
    || !Array.isArray(snapshot.targets)) {
    throw new Error('Invalid knowhow lifecycle snapshot');
  }
  for (const target of snapshot.targets) {
    if (target.beforeBase64 !== null
      && sha256(Buffer.from(target.beforeBase64, 'base64')) !== target.beforeHash) {
      throw new Error(`Snapshot before hash is invalid: ${target.path}`);
    }
    if ((target.beforeBase64 === null) !== target.expectedAbsent) {
      throw new Error(`Snapshot absence marker is invalid: ${target.path}`);
    }
  }
}

export function createKnowhowLifecycleSnapshot(
  projectRoot: string,
  options: CreateKnowhowSnapshotOptions,
): KnowhowLifecycleSnapshot {
  return withLifecycleLock(projectRoot, () => {
    recoverLifecycleUnlocked(projectRoot);
    const nodes = scanKnowhow(projectRoot);
    const oldNode = nodes.get(options.oldId);
    if (!oldNode) throw new Error(`Knowhow id not found: ${options.oldId}`);

    const paths = [
      oldNode.relativePath,
      options.newPath,
      ...(options.includeRelative ?? []),
    ];
    const uniquePaths = [...new Set(paths.map(path => relativePath(
      projectRoot,
      resolveSnapshotTargetInput(projectRoot, path),
    )))].sort();
    const snapshot: KnowhowLifecycleSnapshot = {
      schema_version: 'knowhow-lifecycle-snapshot/1.0',
      createdAt: new Date().toISOString(),
      sealedAt: null,
      oldId: options.oldId,
      newId: options.newId,
      targets: uniquePaths.map(path => captureSnapshotTarget(projectRoot, path)),
    };
    const out = resolveSnapshotPath(projectRoot, options.out, 'write-target');
    ensureLifecycleDirectory(projectRoot, dirname(out));
    if (readLifecycleBoundOptional(projectRoot, out)) {
      throw new Error(`Snapshot already exists: ${relativePath(projectRoot, out)}`);
    }
    writeJsonAtomic(projectRoot, out, snapshot);
    return snapshot;
  });
}

export function sealKnowhowLifecycleSnapshot(
  projectRoot: string,
  snapshotPath: string,
): KnowhowLifecycleSnapshot {
  return withLifecycleLock(projectRoot, () => {
    recoverLifecycleUnlocked(projectRoot);
    const path = resolveSnapshotPath(projectRoot, snapshotPath, 'existing-file');
    const snapshot = readJson<KnowhowLifecycleSnapshot>(projectRoot, path);
    assertSnapshot(snapshot);
    if (snapshot.sealedAt) return snapshot;
    const sealed: KnowhowLifecycleSnapshot = {
      ...snapshot,
      sealedAt: new Date().toISOString(),
      targets: snapshot.targets.map(target => ({
        ...target,
        afterHash: hashFile(projectRoot, target.path),
      })),
    };
    writeJsonAtomic(projectRoot, path, sealed);
    return sealed;
  });
}

function restorePaths(snapshotPath: string): { intentPath: string; receiptPath: string } {
  return {
    intentPath: `${snapshotPath}.restore.intent.json`,
    receiptPath: `${snapshotPath}.restore.receipt.json`,
  };
}

function restoreRequestPayload(intent: Pick<
  KnowhowRestoreIntent,
  'requestId' | 'operation' | 'subject' | 'claimedRun' | 'targets'
>): unknown {
  return {
    requestId: intent.requestId,
    operation: intent.operation,
    subject: intent.subject,
    claimedRun: intent.claimedRun,
    targets: intent.targets.map(target => ({
      path: target.path,
      beforeHash: target.beforeHash,
      afterHash: target.afterHash,
      restoreHash: target.restoreHash,
    })),
  };
}

function restoreOutcomePayload(receipt: Pick<
  KnowhowRestoreReceipt,
  'status' | 'targets' | 'conflict'
>): unknown {
  return {
    status: receipt.status,
    targets: receipt.targets.map(target => ({
      path: target.path,
      restoreHash: target.restoreHash,
      completed: target.completed,
    })),
    conflict: receipt.conflict,
  };
}

function receiptRestoreTargets(
  targets: RestoreTargetState[],
): RestoreTargetState[] {
  return targets.map(({ quarantine: _quarantine, ...target }) => ({ ...target }));
}

function createRestoreReceipt(intent: KnowhowRestoreIntent): KnowhowRestoreReceipt {
  const outcome: Pick<
    KnowhowRestoreReceipt,
    'status' | 'targets' | 'conflict'
  > = {
    status: intent.status === 'conflict' ? 'conflict' : 'completed',
    targets: receiptRestoreTargets(intent.targets),
    ...(intent.conflict ? { conflict: { ...intent.conflict } } : {}),
  };
  return {
    schema_version: 'knowhow-restore-receipt/1.0',
    requestId: intent.requestId,
    operation: intent.operation,
    status: outcome.status,
    subject: intent.subject,
    claimedRun: intent.claimedRun,
    requestHash: intent.requestHash,
    resultHash: sha256(stableJson(restoreOutcomePayload(outcome))),
    targets: outcome.targets,
    ...(outcome.conflict ? { conflict: outcome.conflict } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function isContentHash(value: unknown): value is ContentHash {
  return value === null
    || (typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseNormalizedRestorePath(value: unknown): string {
  if (!isNonEmptyString(value)
    || value.includes('\0')
    || value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)) {
    throw new Error('Invalid or unbound knowhow restore intent');
  }
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
    || segments.join('/') !== value) {
    throw new Error('Invalid or unbound knowhow restore intent');
  }
  return value;
}

function isPlatformIdentity(
  value: unknown,
  platform: 'windows' | 'posix',
): boolean {
  if (!isRecord(value)) return false;
  if (platform === 'posix') {
    return hasExactKeys(value, ['kind', 'dev', 'ino', 'mode'])
      && value.kind === 'posix'
      && isNonEmptyString(value.dev)
      && isNonEmptyString(value.ino)
      && Number.isSafeInteger(value.mode)
      && (value.mode as number) >= 0;
  }
  return hasExactKeys(value, [
    'kind',
    'volumeSerial',
    'fileId128',
    'fileAttributes',
    'reparseTag',
  ])
    && value.kind === 'windows'
    && isNonEmptyString(value.volumeSerial)
    && isNonEmptyString(value.fileId128)
    && Number.isSafeInteger(value.fileAttributes)
    && (value.fileAttributes as number) >= 0
    && (value.reparseTag === null
      || (Number.isSafeInteger(value.reparseTag) && (value.reparseTag as number) >= 0));
}

function isLifecycleGeneration(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'schema_version',
      'platform',
      'root',
      'parentChain',
      'entry',
      'sha256',
      'ownerGeneration',
    ])
    || value.schema_version !== 'lifecycle-fs-generation/1.0'
    || (value.platform !== 'windows' && value.platform !== 'posix')
    || !Array.isArray(value.parentChain)
    || !isContentHash(value.sha256)
    || value.sha256 === null
    || (value.ownerGeneration !== null && !isNonEmptyString(value.ownerGeneration))) {
    return false;
  }
  const platform = value.platform as 'windows' | 'posix';
  return isPlatformIdentity(value.root, platform)
    && value.parentChain.every(identity => isPlatformIdentity(identity, platform))
    && isPlatformIdentity(value.entry, platform);
}

function isBoundRestoreQuarantine(
  value: unknown,
  requestId: string,
  target: RestoreTargetState,
): value is BoundQuarantine {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'originalRelativePath',
      'quarantineRelativePath',
      'requestId',
      'ownerGeneration',
      'expectedSha256',
      'generation',
    ])
    || !isNonEmptyString(value.ownerGeneration)
    || value.requestId !== requestId
    || value.originalRelativePath !== target.path
    || value.expectedSha256 !== target.afterHash
    || target.afterHash === null
    || !isLifecycleGeneration(value.generation)) {
    return false;
  }
  try {
    parseNormalizedRestorePath(value.originalRelativePath);
    parseNormalizedRestorePath(value.quarantineRelativePath);
  } catch {
    return false;
  }
  const generation = value.generation as BoundQuarantine['generation'];
  return generation.ownerGeneration === value.ownerGeneration
    && generation.sha256 === value.expectedSha256;
}

export function parseRestoreIntent(
  value: unknown,
  snapshot: KnowhowLifecycleSnapshot,
  expectedSubject: string,
): KnowhowRestoreIntent {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'schema_version',
      'requestId',
      'operation',
      'status',
      'subject',
      'claimedRun',
      'requestHash',
      'targets',
      ...(Object.hasOwn(value, 'conflict') ? ['conflict'] : []),
    ])
    || value.schema_version !== 'knowhow-restore-intent/1.0'
    || value.operation !== 'restore'
    || (value.status !== 'pending'
      && value.status !== 'completed'
      && value.status !== 'conflict')
    || !isNonEmptyString(value.requestId)
    || !isNonEmptyString(value.subject)
    || !isNonEmptyString(value.claimedRun)
    || !isContentHash(value.requestHash)
    || value.requestHash === null
    || !Array.isArray(value.targets)
    || value.targets.length === 0
    || !Array.isArray(snapshot.targets)) {
    throw new Error('Invalid or unbound knowhow restore intent');
  }

  const subject = parseNormalizedRestorePath(value.subject);
  if (subject !== parseNormalizedRestorePath(expectedSubject)) {
    throw new Error('Restore intent subject does not match snapshot');
  }

  const snapshotByPath = new Map<string, KnowhowSnapshotTarget>();
  for (const snapshotTarget of snapshot.targets) {
    if (!isRecord(snapshotTarget)
      || !isContentHash(snapshotTarget.beforeHash)
      || !isContentHash(snapshotTarget.afterHash)) {
      throw new Error('Restore intent targets do not match snapshot');
    }
    const path = parseNormalizedRestorePath(snapshotTarget.path);
    if (snapshotByPath.has(path)) {
      throw new Error('Restore intent targets do not match snapshot');
    }
    snapshotByPath.set(path, snapshotTarget as unknown as KnowhowSnapshotTarget);
  }
  if (snapshotByPath.size === 0 || value.targets.length !== snapshotByPath.size) {
    throw new Error('Restore intent targets do not match snapshot');
  }

  const intent = value as unknown as KnowhowRestoreIntent;
  const targetPaths = new Set<string>();
  for (const targetInput of value.targets) {
    if (!isRecord(targetInput)
      || !hasExactKeys(targetInput, [
        'path',
        'beforeHash',
        'afterHash',
        'restoreHash',
        'completed',
        ...(Object.hasOwn(targetInput, 'quarantine') ? ['quarantine'] : []),
      ])
      || !isContentHash(targetInput.beforeHash)
      || !isContentHash(targetInput.afterHash)
      || !isContentHash(targetInput.restoreHash)
      || typeof targetInput.completed !== 'boolean') {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
    const path = parseNormalizedRestorePath(targetInput.path);
    if (targetPaths.has(path)) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
    const snapshotTarget = snapshotByPath.get(path);
    if (!snapshotTarget
      || snapshotTarget.beforeHash !== targetInput.beforeHash
      || snapshotTarget.afterHash !== targetInput.afterHash
      || snapshotTarget.beforeHash !== targetInput.restoreHash) {
      throw new Error('Restore intent targets do not match snapshot');
    }
    const target = targetInput as unknown as RestoreTargetState;
    if (Object.hasOwn(targetInput, 'quarantine')
      && !isBoundRestoreQuarantine(targetInput.quarantine, intent.requestId, target)) {
      throw new Error(`Invalid or unbound restore quarantine: ${path}`);
    }
    if (target.completed && target.quarantine) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
    targetPaths.add(path);
  }

  const orderedPaths = intent.targets.map(target => target.path);
  if (stableJson(orderedPaths) !== stableJson([...targetPaths].sort())) {
    throw new Error('Invalid or unbound knowhow restore intent');
  }
  const hasQuarantine = intent.targets.some(target => target.quarantine !== undefined);
  if (intent.status === 'pending') {
    if (intent.conflict !== undefined) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
  } else if (intent.status === 'completed') {
    if (intent.conflict !== undefined
      || hasQuarantine
      || intent.targets.some(target => !target.completed)) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
  } else {
    if (hasQuarantine
      || !isRecord(intent.conflict)
      || !hasExactKeys(intent.conflict, ['path', 'expectedHash', 'actualHash'])
      || !isContentHash(intent.conflict.expectedHash)
      || !isContentHash(intent.conflict.actualHash)) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
    const conflictPath = parseNormalizedRestorePath(intent.conflict.path);
    const conflictTarget = intent.targets.find(target => target.path === conflictPath);
    const expectedHash = conflictTarget?.completed
      ? conflictTarget.restoreHash
      : conflictTarget?.afterHash;
    if (!conflictTarget
      || intent.conflict.expectedHash !== expectedHash
      || intent.conflict.actualHash === expectedHash) {
      throw new Error('Invalid or unbound knowhow restore intent');
    }
  }

  if (sha256(stableJson(restoreRequestPayload(intent))) !== intent.requestHash) {
    throw new Error('Invalid or unbound knowhow restore intent');
  }
  return intent;
}

function assertRestoreReceipt(
  receiptInput: unknown,
  intent: KnowhowRestoreIntent,
): asserts receiptInput is KnowhowRestoreReceipt {
  if (!isRecord(receiptInput)
    || !hasExactKeys(receiptInput, [
      'schema_version',
      'requestId',
      'operation',
      'status',
      'subject',
      'claimedRun',
      'requestHash',
      'resultHash',
      'targets',
      ...(Object.hasOwn(receiptInput, 'conflict') ? ['conflict'] : []),
    ])) {
    throw new Error('Invalid or unbound knowhow restore receipt');
  }
  const receipt = receiptInput as unknown as KnowhowRestoreReceipt;
  const stringFields = [
    receipt.requestId,
    receipt.subject,
    receipt.claimedRun,
  ];
  if (receipt.schema_version !== 'knowhow-restore-receipt/1.0'
    || receipt.operation !== 'restore'
    || (receipt.status !== 'completed' && receipt.status !== 'conflict')
    || stringFields.some(value => typeof value !== 'string' || value.length === 0)
    || !isContentHash(receipt.requestHash)
    || receipt.requestHash === null
    || !isContentHash(receipt.resultHash)
    || receipt.resultHash === null
    || !Array.isArray(receipt.targets)
    || receipt.targets.length === 0) {
    throw new Error('Invalid or unbound knowhow restore receipt');
  }

  const targetPaths = new Set<string>();
  for (const target of receipt.targets) {
    if (!isRecord(target)
      || !hasExactKeys(target, [
        'path',
        'beforeHash',
        'afterHash',
        'restoreHash',
        'completed',
      ])
      || typeof target.path !== 'string'
      || target.path.length === 0
      || targetPaths.has(target.path)
      || !isContentHash(target.beforeHash)
      || !isContentHash(target.afterHash)
      || !isContentHash(target.restoreHash)
      || typeof target.completed !== 'boolean') {
      throw new Error('Invalid or unbound knowhow restore receipt');
    }
    targetPaths.add(target.path);
  }

  if (receipt.status === 'completed') {
    if (receipt.conflict !== undefined
      || receipt.targets.some(target => !target.completed)) {
      throw new Error('Invalid or unbound knowhow restore receipt');
    }
  } else {
    if (!isRecord(receipt.conflict)
      || !hasExactKeys(receipt.conflict, ['path', 'expectedHash', 'actualHash'])
      || typeof receipt.conflict.path !== 'string'
      || receipt.conflict.path.length === 0
      || !isContentHash(receipt.conflict.expectedHash)
      || !isContentHash(receipt.conflict.actualHash)) {
      throw new Error('Invalid or unbound knowhow restore receipt');
    }
    const conflictTarget = receipt.targets.find(
      target => target.path === receipt.conflict!.path,
    );
    const expectedHash = conflictTarget?.completed
      ? conflictTarget.restoreHash
      : conflictTarget?.afterHash;
    if (!conflictTarget
      || receipt.conflict.expectedHash !== expectedHash
      || receipt.conflict.actualHash === expectedHash) {
      throw new Error('Invalid or unbound knowhow restore receipt');
    }
  }

  if (receipt.resultHash !== sha256(stableJson(restoreOutcomePayload(receipt)))
    || receipt.requestId !== intent.requestId
    || receipt.operation !== intent.operation
    || receipt.status !== intent.status
    || receipt.subject !== intent.subject
    || receipt.claimedRun !== intent.claimedRun
    || receipt.requestHash !== intent.requestHash
    || stableJson(receipt.targets) !== stableJson(receiptRestoreTargets(intent.targets))
    || stableJson(receipt.conflict) !== stableJson(intent.conflict)) {
    throw new Error('Invalid or unbound knowhow restore receipt');
  }
}

function readOrPersistRestoreReceipt(
  projectRoot: string,
  receiptPath: string,
  intent: KnowhowRestoreIntent,
): KnowhowRestoreReceipt {
  let persisted = readLifecycleBoundOptional(projectRoot, receiptPath);
  if (!persisted) {
    writeJsonAtomic(projectRoot, receiptPath, createRestoreReceipt(intent));
    persisted = readLifecycleBoundOptional(projectRoot, receiptPath);
    if (!persisted) {
      throw new Error('Knowhow restore receipt was not durably persisted');
    }
  }
  const receiptInput = parseLifecycleJson<unknown>(persisted);
  assertRestoreReceipt(receiptInput, intent);
  return receiptInput;
}

function assertTerminalRestoreTargets(
  projectRoot: string,
  intent: KnowhowRestoreIntent,
): void {
  if (intent.status === 'pending') {
    throw new Error('Pending restore intent is not terminal');
  }
  for (const target of intent.targets) {
    const expectedHash = intent.status === 'conflict'
      && intent.conflict?.path === target.path
      ? intent.conflict.actualHash
      : target.completed
        ? target.restoreHash
        : target.afterHash;
    const actualHash = hashFile(projectRoot, target.path);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Restore terminal replay drift at ${target.path}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }
}

function markRestoreConflict(
  projectRoot: string,
  intentPath: string,
  receiptPath: string,
  intent: KnowhowRestoreIntent,
  target: RestoreTargetState,
  expectedHash: ContentHash,
  actualHash: ContentHash,
): RestoreKnowhowResult {
  intent.status = 'conflict';
  intent.conflict = { path: target.path, expectedHash, actualHash };
  writeJsonAtomic(projectRoot, intentPath, intent);
  const receipt = readOrPersistRestoreReceipt(projectRoot, receiptPath, intent);
  assertTerminalRestoreTargets(projectRoot, intent);
  return {
    success: false,
    replayed: false,
    intent,
    receipt,
    code: 'KNOWHOW_RESTORE_CONFLICT',
    error: `Restore conflict at ${target.path}: expected ${expectedHash}, got ${actualHash}`,
  };
}

function restoreTarget(
  projectRoot: string,
  snapshotTarget: KnowhowSnapshotTarget,
  target: RestoreTargetState,
  intent: KnowhowRestoreIntent,
  intentPath: string,
  options?: RestoreKnowhowOptions,
): void {
  const relativeTarget = lifecycleRelativePath(projectRoot, target.path);
  withTargetWriterLock(projectRoot, relativeTarget, writerLock => {
    if (target.quarantine) {
      const recovery = recoverLifecycleQuarantineBound(
        projectRoot,
        target.quarantine,
        'commit',
      );
      if (recovery === 'replaced' && readLifecycleBoundOptional(projectRoot, relativeTarget)) {
        throw new Error(`Restore quarantine generation was replaced: ${target.path}`);
      }
      target.quarantine = undefined;
      writeJsonAtomic(projectRoot, intentPath, intent);
    } else {
      const current = readLifecycleBoundOptional(projectRoot, relativeTarget);
      const currentHash = current ? sha256(current.bytes) : null;
      if (currentHash !== target.afterHash) {
        throw new Error(`Restore fence changed before write: ${target.path}`);
      }
      if (snapshotTarget.beforeBase64 === null) {
        if (!current || target.afterHash === null) {
          throw new Error(`Restore delete target is unexpectedly absent: ${target.path}`);
        }
        const quarantine = quarantineLifecycleFileBound(
          projectRoot,
          relativeTarget,
          current.generation.sha256,
          intent.requestId,
          writerLock.ownerGeneration,
        );
        target.quarantine = quarantine;
        writeJsonAtomic(projectRoot, intentPath, intent);
        options?.afterTargetQuarantine?.(target.path, quarantine);
        const recovery = recoverLifecycleQuarantineBound(
          projectRoot,
          quarantine,
          'commit',
        );
        if (recovery !== 'committed') {
          throw new Error(`Restore delete lost exact quarantine: ${target.path}`);
        }
        target.quarantine = undefined;
        writeJsonAtomic(projectRoot, intentPath, intent);
      } else {
        const content = Buffer.from(snapshotTarget.beforeBase64, 'base64');
        replaceLifecycleFileBound(
          projectRoot,
          relativeTarget,
          content,
          current?.generation ?? null,
          writerLock.ownerGeneration,
        );
      }
    }
    if (hashFile(projectRoot, relativeTarget) !== target.restoreHash) {
      throw new Error(`Restore output hash mismatch: ${target.path}`);
    }
  });
}

export function restoreKnowhowLifecycleSnapshot(
  projectRoot: string,
  snapshotPathInput: string,
  options?: RestoreKnowhowOptions,
): RestoreKnowhowResult {
  try {
    return withLifecycleLock(projectRoot, () => {
      recoverLifecycleUnlocked(projectRoot);
      const snapshotPath = resolveSnapshotPath(projectRoot, snapshotPathInput, 'existing-file');
      const snapshot = readJson<KnowhowLifecycleSnapshot>(projectRoot, snapshotPath);
      assertSnapshot(snapshot);
      if (!snapshot.sealedAt) throw new Error('Knowhow lifecycle snapshot must be sealed before restore');
      for (const target of snapshot.targets) {
        lifecycleRelativePath(projectRoot, target.path);
      }

      const rawRestorePaths = restorePaths(snapshotPath);
      const intentPath = rawRestorePaths.intentPath;
      const receiptPath = rawRestorePaths.receiptPath;
      const subject = relativePath(projectRoot, snapshotPath);
      let intent: KnowhowRestoreIntent;
      let replayed = false;
      const existingIntent = readLifecycleBoundOptional(projectRoot, intentPath);
      if (existingIntent) {
        intent = parseRestoreIntent(
          parseLifecycleJson<unknown>(existingIntent),
          snapshot,
          subject,
        );
        replayed = true;
      } else {
        const claimedRun = options?.claimedRun
          ?? process.env.MAESTRO_RUN_ID
          ?? 'standalone';
        const targets: RestoreTargetState[] = snapshot.targets
          .map(target => ({
            path: target.path,
            beforeHash: target.beforeHash,
            afterHash: target.afterHash,
            restoreHash: target.beforeHash,
            completed: false,
          }))
          .sort((left, right) => left.path.localeCompare(right.path));
        const base = {
          requestId: `restore_${randomUUID()}`,
          operation: 'restore' as const,
          subject,
          claimedRun,
          targets,
        };
        intent = {
          schema_version: 'knowhow-restore-intent/1.0',
          ...base,
          status: 'pending',
          requestHash: sha256(stableJson(restoreRequestPayload(base))),
        };
        intent = parseRestoreIntent(intent, snapshot, subject);
        writeJsonAtomic(projectRoot, intentPath, intent);
      }

      const snapshotByPath = new Map(snapshot.targets.map(target => [target.path, target]));

      if (intent.status === 'conflict') {
        const receipt = readOrPersistRestoreReceipt(projectRoot, receiptPath, intent);
        assertTerminalRestoreTargets(projectRoot, intent);
        return {
          success: false,
          replayed: true,
          intent,
          receipt,
          code: 'KNOWHOW_RESTORE_CONFLICT',
          error: `Restore remains in conflict at ${intent.conflict?.path ?? 'unknown target'}`,
        };
      }

      let completedCount = intent.targets.filter(target => target.completed).length;
      for (const target of intent.targets) {
        if (target.quarantine) continue;
        const actualHash = hashFile(projectRoot, target.path);
        if (target.completed) {
          if (actualHash === target.restoreHash) continue;
          return markRestoreConflict(
            projectRoot,
            intentPath,
            receiptPath,
            intent,
            target,
            target.restoreHash,
            actualHash,
          );
        }
        if (actualHash === target.restoreHash) {
          target.completed = true;
          completedCount++;
          writeJsonAtomic(projectRoot, intentPath, intent);
          options?.afterTarget?.(target.path, completedCount);
          continue;
        }
        if (actualHash !== target.afterHash) {
          return markRestoreConflict(
            projectRoot,
            intentPath,
            receiptPath,
            intent,
            target,
            target.afterHash,
            actualHash,
          );
        }
      }

      if (intent.status === 'completed') {
        const receipt = readOrPersistRestoreReceipt(projectRoot, receiptPath, intent);
        assertTerminalRestoreTargets(projectRoot, intent);
        return { success: true, replayed: true, intent, receipt };
      }

      for (const target of intent.targets) {
        if (target.completed) continue;
        const snapshotTarget = snapshotByPath.get(target.path)!;
        restoreTarget(
          projectRoot,
          snapshotTarget,
          target,
          intent,
          intentPath,
          options,
        );
        options?.beforeTargetCheckpoint?.(target.path, completedCount + 1);
        target.completed = true;
        completedCount++;
        writeJsonAtomic(projectRoot, intentPath, intent);
        options?.afterTarget?.(target.path, completedCount);
      }

      intent.status = 'completed';
      writeJsonAtomic(projectRoot, intentPath, intent);
      const receipt = readOrPersistRestoreReceipt(projectRoot, receiptPath, intent);
      assertTerminalRestoreTargets(projectRoot, intent);
      return { success: true, replayed, intent, receipt };
    }, options);
  } catch (error) {
    let safeSnapshotPath: string | null = null;
    let persistedIntent: KnowhowRestoreIntent | null = null;
    try {
      safeSnapshotPath = resolveSnapshotPath(projectRoot, snapshotPathInput, 'delete-target');
      const candidateIntentPath = restorePaths(safeSnapshotPath).intentPath;
      const persistedRead = readLifecycleBoundOptional(projectRoot, candidateIntentPath);
      if (persistedRead) {
        persistedIntent = parseLifecycleJson<KnowhowRestoreIntent>(persistedRead);
      }
    } catch {
      safeSnapshotPath = null;
      persistedIntent = null;
    }
    const fallback: KnowhowRestoreIntent = persistedIntent ?? {
        schema_version: 'knowhow-restore-intent/1.0',
        requestId: '',
        operation: 'restore',
        status: 'conflict',
        subject: safeSnapshotPath
          ? relativePath(projectRoot, safeSnapshotPath)
          : snapshotPathInput.replaceAll('\\', '/'),
        claimedRun: options?.claimedRun ?? 'standalone',
        requestHash: '',
        targets: [],
      };
    return {
      success: false,
      replayed: persistedIntent !== null,
      intent: fallback,
      code: 'KNOWHOW_RESTORE_FAILED',
      error: (error as Error).message,
    };
  }
}

export function recoverKnowhowRestoreIntent(
  projectRoot: string,
  snapshotPath: string,
  options?: RestoreKnowhowOptions,
): RestoreKnowhowResult {
  return restoreKnowhowLifecycleSnapshot(projectRoot, snapshotPath, options);
}
