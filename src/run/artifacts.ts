import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { artifactMetaSchema, type ArtifactMeta, type Artifact } from './schemas.js';
import type { CommandContract } from './contract.js';

export interface DiscoveredArtifact {
  absolutePath: string;
  relativePath: string;
  kind: string;
  schemaVersion: string;
  role: Artifact['role'];
  alias?: string;
  mediaType: string;
  contentHash: string;
  size: number;
  warning?: string;
}

export interface ArtifactScanResult {
  artifacts: DiscoveredArtifact[];
  warnings: string[];
  errors: string[];
}

export interface ArtifactScanHooks {
  afterFileInspection?: (path: string) => void;
}

export interface StrictArtifactValidationOptions {
  skipArtifactMetadataValidation?: boolean;
}

export interface ArtifactContractReport {
  declared: Array<{
    path: string | null;
    kind: string;
    schema: string | null;
    role: string;
    required: boolean;
    alias: string | null;
  }>;
  observed: Array<{
    path: string;
    kind: string;
    schema: string;
    role: string;
    alias: string | null;
  }>;
  missing: string[];
  mismatches: string[];
  unexpected: string[];
  errors: string[];
  warnings: string[];
}

export interface VerifiedContainedFile {
  data: Buffer;
  canonicalPath: string;
  contentHash: string;
  size: number;
}

type FileStat = NonNullable<ReturnType<typeof lstatSync>>;

interface SafePathSnapshot {
  canonicalPath: string;
  stat: FileStat;
}

interface ArtifactCandidate {
  absolutePath: string;
  canonicalParent: string;
  snapshot: SafePathSnapshot;
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathContained(canonicalRoot: string, canonicalPath: string): boolean {
  const root = comparablePath(canonicalRoot);
  const candidate = comparablePath(canonicalPath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function inspectSafePath(
  path: string,
  canonicalParent: string,
  canonicalRoot: string,
): SafePathSnapshot | null {
  try {
    const stat = lstatSync(path);
    if (!stat || stat.isSymbolicLink()) return null;

    const canonicalPath = realpathSync(path);
    const expectedCanonicalPath = join(canonicalParent, basename(path));
    if (
      comparablePath(canonicalPath) !== comparablePath(expectedCanonicalPath)
      || !isPathContained(canonicalRoot, canonicalPath)
    ) return null;

    return { canonicalPath, stat };
  } catch {
    return null;
  }
}

function sameIdentity(left: FileStat, right: FileStat): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.isFile() === right.isFile()
    && left.isDirectory() === right.isDirectory();
}

function sameStableState(left: FileStat, right: FileStat): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function unsafePath(path: string, detail: string): Error {
  return new Error(`unsafe path changed during artifact scan: ${path} (${detail})`);
}

function requireSafePath(
  path: string,
  canonicalParent: string,
  canonicalRoot: string,
): SafePathSnapshot {
  const inspected = inspectSafePath(path, canonicalParent, canonicalRoot);
  if (!inspected) throw unsafePath(path, 'symlink, missing path, or containment mismatch');
  return inspected;
}

function assertSnapshotMatches(
  path: string,
  expected: SafePathSnapshot,
  actual: SafePathSnapshot,
  stable = false,
): void {
  if (comparablePath(expected.canonicalPath) !== comparablePath(actual.canonicalPath)
    || !(stable ? sameStableState(expected.stat, actual.stat) : sameIdentity(expected.stat, actual.stat))) {
    throw unsafePath(path, 'filesystem identity mismatch');
  }
}

function readVerifiedFile(
  path: string,
  canonicalParent: string,
  canonicalRoot: string,
  expected?: SafePathSnapshot,
  hooks?: ArtifactScanHooks,
): { data: Buffer; stat: FileStat } {
  const before = requireSafePath(path, canonicalParent, canonicalRoot);
  if (expected) assertSnapshotMatches(path, expected, before);
  if (!before.stat.isFile()) throw unsafePath(path, 'expected a regular file');

  hooks?.afterFileInspection?.(path);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (!opened.isFile() || !sameIdentity(before.stat, opened)) {
      throw unsafePath(path, 'opened descriptor does not match inspected file');
    }

    const data = readFileSync(fd);
    const afterRead = fstatSync(fd);
    if (!sameStableState(opened, afterRead)) {
      throw unsafePath(path, 'file changed while reading');
    }

    const afterPath = requireSafePath(path, canonicalParent, canonicalRoot);
    assertSnapshotMatches(path, before, afterPath, true);
    if (!sameStableState(afterRead, afterPath.stat)) {
      throw unsafePath(path, 'path no longer references the opened descriptor');
    }
    return { data, stat: afterRead };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('unsafe path changed during artifact scan:')) {
      throw error;
    }
    throw unsafePath(path, (error as NodeJS.ErrnoException).code ?? (error as Error).message);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function stableDirectoryEntries(
  path: string,
  canonicalParent: string,
  canonicalRoot: string,
  expected?: SafePathSnapshot,
): { entries: string[]; snapshot: SafePathSnapshot } {
  const before = requireSafePath(path, canonicalParent, canonicalRoot);
  if (expected) assertSnapshotMatches(path, expected, before);
  if (!before.stat.isDirectory()) throw unsafePath(path, 'expected a directory');
  const entries = readdirSync(path).sort();
  const after = requireSafePath(path, canonicalParent, canonicalRoot);
  assertSnapshotMatches(path, before, after, true);
  return { entries, snapshot: after };
}

function hashBuffer(data: Buffer): { hash: string; size: number } {
  return { hash: createHash('sha256').update(data).digest('hex'), size: data.byteLength };
}

/**
 * Read one regular file through the same descriptor and containment fences used
 * by artifact scanning. Relative inputs are resolved from `root`; absolute
 * inputs are accepted only when their canonical path remains inside `root`.
 */
export function readVerifiedContainedFile(
  root: string,
  inputPath: string,
  hooks?: ArtifactScanHooks,
): VerifiedContainedFile {
  let canonicalRoot: string;
  let candidate: string;
  let canonicalParent: string;
  try {
    canonicalRoot = realpathSync(resolve(root));
    candidate = resolve(isAbsolute(inputPath) ? inputPath : join(root, inputPath));
    canonicalParent = realpathSync(dirname(candidate));
  } catch (error) {
    throw unsafePath(inputPath, (error as NodeJS.ErrnoException).code ?? (error as Error).message);
  }
  const rootStat = lstatSync(canonicalRoot);
  if (!rootStat.isDirectory()) throw unsafePath(root, 'containment root is not a directory');
  const verified = readVerifiedFile(candidate, canonicalParent, canonicalRoot, undefined, hooks);
  const hashed = hashBuffer(verified.data);
  return {
    data: verified.data,
    canonicalPath: realpathSync(candidate),
    contentHash: hashed.hash,
    size: hashed.size,
  };
}

function hashVerifiedDirectory(
  path: string,
  canonicalParent: string,
  canonicalRoot: string,
  expected?: SafePathSnapshot,
  hooks?: ArtifactScanHooks,
): { hash: string; size: number } {
  const hash = createHash('sha256');
  let size = 0;
  const rootSnapshot = requireSafePath(path, canonicalParent, canonicalRoot);
  if (expected) assertSnapshotMatches(path, expected, rootSnapshot);
  if (!rootSnapshot.stat.isDirectory()) throw unsafePath(path, 'expected a directory');

  const walk = (
    dir: string,
    parent: string,
    snapshot: SafePathSnapshot,
    prefix: string,
  ): void => {
    const listed = stableDirectoryEntries(dir, parent, canonicalRoot, snapshot);
    for (const name of listed.entries) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const inspected = inspectSafePath(full, listed.snapshot.canonicalPath, canonicalRoot);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) walk(full, listed.snapshot.canonicalPath, inspected, rel);
      else if (inspected.stat.isFile()) {
        const { data } = readVerifiedFile(
          full,
          listed.snapshot.canonicalPath,
          canonicalRoot,
          inspected,
          hooks,
        );
        hash.update(rel).update('\0').update(data).update('\0');
        size += data.byteLength;
      }
    }
    const afterWalk = requireSafePath(dir, parent, canonicalRoot);
    assertSnapshotMatches(dir, listed.snapshot, afterWalk, true);
  };
  walk(path, canonicalParent, rootSnapshot, '');
  return { hash: hash.digest('hex'), size };
}

export function hashFile(path: string): { hash: string; size: number } {
  const canonicalParent = realpathSync(dirname(path));
  return hashBuffer(readVerifiedFile(path, canonicalParent, canonicalParent).data);
}

/**
 * Read one file with the same verified fd/fstat/realpath containment fence as
 * artifact scans: the path must resolve to a regular file directly inside its
 * canonical parent, the opened descriptor must match the inspected identity,
 * and the bytes must be stable across the read. Returns the content plus its
 * plain sha256 hex digest.
 */
export function readContainedFile(path: string): { data: Buffer; hash: string } {
  const canonicalParent = realpathSync(dirname(path));
  const { data } = readVerifiedFile(path, canonicalParent, canonicalParent);
  return { data, hash: createHash('sha256').update(data).digest('hex') };
}

export function hashDirectory(path: string): { hash: string; size: number } {
  const canonicalParent = realpathSync(dirname(path));
  const root = requireSafePath(path, canonicalParent, canonicalParent);
  return hashVerifiedDirectory(path, canonicalParent, root.canonicalPath, root);
}

function inferMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.ndjson':
    case '.jsonl': return 'application/x-ndjson';
    case '.md': return 'text/markdown';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.txt':
    case '.log': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

function jsonArtifactMeta(parsed: unknown): ArtifactMeta | null {
  const hasMeta = typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, '_meta');
  if (!hasMeta) return null;

  const rawMeta = (parsed as { _meta: unknown })._meta;
  const result = artifactMetaSchema.safeParse(rawMeta);
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `${issue.path.join('.') || '_meta'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid _meta; expected non-empty kind and schema${detail ? ` (${detail})` : ''}`);
  }
  return result.data;
}

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function markdownMeta(raw: string): ArtifactMeta | null {
  const match = stripUtf8Bom(raw).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null;
  return artifactMetaSchema.parse({
    kind: parsed.kind,
    schema: typeof parsed.schema === 'string' ? parsed.schema : `${parsed.kind}/1.0`,
    role: parsed.role,
    alias: parsed.alias,
  });
}

function declaredProduce(contract: CommandContract, outputRelative: string) {
  return contract.produces.find(item => item.path && declaredPathMatches(item.path, outputRelative));
}

function normalizeOutputPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function declaredPathMatches(declaredPath: string, outputRelative: string): boolean {
  const declared = normalizeOutputPath(declaredPath);
  const actual = normalizeOutputPath(outputRelative);
  if (!declared.includes('{')) return declared === actual;
  const pattern = declared
    .split(/(\{[^/{}]+\})/g)
    .filter(Boolean)
    .map(part => /^\{[^/{}]+\}$/.test(part)
      ? '[^/]+'
      : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
  return new RegExp(`^${pattern}$`).test(actual);
}

export function defaultArtifactAlias(kind: string, command: string): string | undefined {
  const value = `${kind} ${command}`.toLowerCase();
  if (value.includes('analy') || value.includes('finding')) return 'current-analysis';
  if (value.includes('plan')) return 'current-plan';
  if (value.includes('execut') || value.includes('change-manifest')) return 'latest-execution';
  if (value.includes('verif')) return 'latest-verification';
  if (value.includes('review')) return 'latest-review';
  if (value.includes('test') || value.includes('acceptance')) return 'latest-test';
  if (value.includes('debug') || value.includes('diagnos')) return 'latest-debug';
  return undefined;
}

export function evaluateArtifactContract(
  runDir: string,
  contract: CommandContract,
  scan: ArtifactScanResult,
  options: StrictArtifactValidationOptions = {},
): ArtifactContractReport {
  const declared = contract.produces.map(expected => ({
    path: expected.path?.replaceAll('\\', '/').replace(/^\.\//, '') ?? null,
    kind: expected.kind,
    schema: typeof expected.schema === 'string' ? expected.schema : null,
    role: expected.role ?? (expected.primary ? 'primary' : 'attachment'),
    required: expected.required ?? false,
    alias: expected.alias ?? null,
  }));
  const observed = scan.artifacts.map(actual => ({
    path: relative(runDir, actual.absolutePath).replaceAll('\\', '/'),
    kind: actual.kind,
    schema: actual.schemaVersion,
    role: actual.role,
    alias: actual.alias ?? null,
  }));
  const missing: string[] = [];
  const mismatches: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const reportMismatch = (message: string): void => {
    mismatches.push(message);
    if (options.skipArtifactMetadataValidation) {
      warnings.push(`artifact metadata validation skipped: ${message}`);
    } else {
      errors.push(message);
    }
  };
  for (const expected of contract.produces) {
    const expectedPath = expected.path?.replaceAll('\\', '/').replace(/^\.\//, '');
    const actuals = expectedPath
      ? scan.artifacts.filter(item => declaredPathMatches(
          expectedPath,
          relative(runDir, item.absolutePath).replaceAll('\\', '/'),
        ))
      : [];
    if (actuals.length === 0) {
      const missingValue = expectedPath ?? expected.kind;
      missing.push(missingValue);
      if (expected.required) errors.push(`Missing required contract v2 output: ${missingValue}`);
      continue;
    }
    for (const actual of actuals) {
      const actualPath = relative(runDir, actual.absolutePath).replaceAll('\\', '/');
      if (actual.kind !== expected.kind) {
        reportMismatch(`${actualPath}: _meta.kind ${actual.kind} does not match contract ${expected.kind}`);
      }
      if (expected.schema && actual.schemaVersion !== expected.schema) {
        reportMismatch(`${actualPath}: _meta.schema ${actual.schemaVersion} does not match contract ${expected.schema}`);
      }
      const expectedRole = expected.role ?? (expected.primary ? 'primary' : 'attachment');
      if (actual.role !== expectedRole) {
        reportMismatch(`${actualPath}: _meta.role ${actual.role} does not match contract ${expectedRole}`);
      }
      if (expected.alias && actual.alias !== expected.alias) {
        reportMismatch(`${actualPath}: _meta.alias ${actual.alias ?? '(missing)'} does not match contract ${expected.alias}`);
      }
    }
  }
  const unexpected = observed
    .filter(actual => !contract.produces.some(expected => expected.path
      && declaredPathMatches(expected.path.replaceAll('\\', '/').replace(/^\.\//, ''), actual.path)))
    .map(actual => actual.path);
  return { declared, observed, missing, mismatches, unexpected, errors, warnings };
}

export function validateStrictArtifactContract(
  runDir: string,
  contract: CommandContract,
  scan: ArtifactScanResult,
  options: StrictArtifactValidationOptions = {},
): void {
  if (contract.contract_version !== 2 && contract.contract_version !== 2.1) return;
  const report = evaluateArtifactContract(runDir, contract, scan, options);
  scan.errors.push(...report.errors);
  scan.warnings.push(...report.warnings);
}

function hasNestedDeclaredTemplate(contract: CommandContract, outputRelative: string): boolean {
  const prefix = `${normalizeOutputPath(outputRelative)}/`;
  return contract.produces.some(item => {
    if (!item.path) return false;
    const declared = normalizeOutputPath(item.path);
    return declared.includes('{') && declared.startsWith(prefix);
  });
}

function collectNestedFiles(
  directory: string,
  canonicalParent: string,
  directorySnapshot: SafePathSnapshot,
  canonicalRoot: string,
): ArtifactCandidate[] {
  const files: ArtifactCandidate[] = [];
  const walk = (current: string, parent: string, snapshot: SafePathSnapshot): void => {
    const listed = stableDirectoryEntries(current, parent, canonicalRoot, snapshot);
    for (const name of listed.entries) {
      const path = join(current, name);
      const inspected = inspectSafePath(path, listed.snapshot.canonicalPath, canonicalRoot);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) walk(path, listed.snapshot.canonicalPath, inspected);
      else if (inspected.stat.isFile()) {
        files.push({ absolutePath: path, canonicalParent: listed.snapshot.canonicalPath, snapshot: inspected });
      }
    }
    const afterWalk = requireSafePath(current, parent, canonicalRoot);
    assertSnapshotMatches(current, listed.snapshot, afterWalk, true);
  };
  walk(directory, canonicalParent, directorySnapshot);
  return files;
}

export function scanOutputs(
  runDir: string,
  sessionDir: string,
  contract: CommandContract,
  hooks?: ArtifactScanHooks,
): ArtifactScanResult {
  const outputsDir = join(runDir, 'outputs');
  const artifacts: DiscoveredArtifact[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!existsSync(outputsDir)) return { artifacts, warnings, errors };

  const canonicalRunDir = realpathSync(runDir);
  const outputsSnapshot = inspectSafePath(outputsDir, canonicalRunDir, canonicalRunDir);
  if (!outputsSnapshot?.stat.isDirectory()) {
    for (const expected of contract.produces) {
      if (expected.path) warnings.push(`Expected ${normalizeOutputPath(expected.path)} was not produced`);
    }
    return { artifacts, warnings, errors };
  }
  const canonicalOutputsDir = outputsSnapshot.canonicalPath;

  let candidates: ArtifactCandidate[] = [];
  try {
    const listed = stableDirectoryEntries(outputsDir, canonicalRunDir, canonicalOutputsDir, outputsSnapshot);
    candidates = listed.entries.flatMap(name => {
      const absolutePath = join(outputsDir, name);
      const outputRelative = `outputs/${name}`;
      const inspected = inspectSafePath(absolutePath, listed.snapshot.canonicalPath, canonicalOutputsDir);
      if (!inspected) return [];
      if (!inspected.stat.isDirectory() || !hasNestedDeclaredTemplate(contract, outputRelative)) {
        return [{ absolutePath, canonicalParent: listed.snapshot.canonicalPath, snapshot: inspected }];
      }
      return collectNestedFiles(
        absolutePath,
        listed.snapshot.canonicalPath,
        inspected,
        canonicalOutputsDir,
      ).filter(candidate => declaredProduce(contract, relative(runDir, candidate.absolutePath)));
    });
    const afterCollect = requireSafePath(outputsDir, canonicalRunDir, canonicalOutputsDir);
    assertSnapshotMatches(outputsDir, listed.snapshot, afterCollect, true);
  } catch (error) {
    errors.push(`outputs: ${(error as Error).message}`);
    for (const expected of contract.produces) {
      if (expected.path) warnings.push(`Expected ${normalizeOutputPath(expected.path)} was not produced`);
    }
    return { artifacts, warnings, errors };
  }
  const directJsonCount = candidates.filter(candidate => (
    candidate.snapshot.stat.isFile() && extname(candidate.absolutePath).toLowerCase() === '.json'
  )).length;
  for (const candidate of candidates) {
    const { absolutePath } = candidate;
    const name = basename(absolutePath);
    const outputRelative = relative(runDir, absolutePath).replaceAll('\\', '/');
    const declared = declaredProduce(contract, outputRelative);
    let kind = declared?.kind ?? basename(name, extname(name));
    let schemaVersion = typeof declared?.schema === 'string' ? declared.schema : `${kind}/1.0`;
    let role: Artifact['role'] = declared?.role ?? (declared?.primary ? 'primary' : 'attachment');
    let alias = declared?.alias;
    let warning: string | undefined;

    try {
      let hashed: { hash: string; size: number };
      let mediaType: string;
      if (candidate.snapshot.stat.isDirectory()) {
        kind = declared?.kind ?? `${name}-collection`;
        schemaVersion = typeof declared?.schema === 'string' ? declared.schema : `${kind}/1.0`;
        hashed = hashVerifiedDirectory(
          absolutePath,
          candidate.canonicalParent,
          canonicalOutputsDir,
          candidate.snapshot,
          hooks,
        );
        mediaType = 'application/vnd.maestro.directory';
      } else {
        const { data } = readVerifiedFile(
          absolutePath,
          candidate.canonicalParent,
          canonicalOutputsDir,
          candidate.snapshot,
          hooks,
        );
        const extension = extname(name).toLowerCase();
        if (extension === '.json' || extension === '.ndjson' || extension === '.jsonl') {
          const raw = stripUtf8Bom(data.toString('utf8'));
          const lineDelimited = extension === '.ndjson' || extension === '.jsonl';
          const selfDescription = lineDelimited ? raw.split(/\r?\n/, 1)[0] : raw;
          const parsed = selfDescription ? JSON.parse(selfDescription) as unknown : null;
          const meta = jsonArtifactMeta(parsed);
          if (meta) {
            kind = meta.kind;
            schemaVersion = meta.schema;
            role = meta.role ?? (!declared && extension === '.json' && directJsonCount === 1 ? 'primary' : role);
            alias = meta.alias ?? alias;
          } else {
            role = !declared && extension === '.json' && directJsonCount === 1 ? 'primary' : role;
            warning = `${outputRelative}: missing _meta; inferred kind=${kind}`;
          }
        } else if (extension === '.md') {
          const meta = markdownMeta(data.toString('utf8'));
          if (meta) {
            kind = meta.kind;
            schemaVersion = meta.schema;
            role = meta.role ?? role;
            alias = meta.alias ?? alias;
          } else {
            warning = `${outputRelative}: missing frontmatter kind; inferred kind=${kind}`;
          }
        } else {
          warning = `${outputRelative}: unsupported self-description; inferred kind=${kind}`;
        }
        hashed = hashBuffer(data);
        mediaType = inferMediaType(absolutePath);
      }

      const discovered: DiscoveredArtifact = {
        absolutePath,
        relativePath: relative(sessionDir, absolutePath).replaceAll('\\', '/'),
        kind,
        schemaVersion,
        role,
        alias,
        mediaType,
        contentHash: hashed.hash,
        size: hashed.size,
        warning,
      };
      artifacts.push(discovered);
      if (warning) warnings.push(warning);
    } catch (error) {
      errors.push(`${outputRelative}: ${(error as Error).message}`);
    }
  }

  try {
    const afterScan = requireSafePath(outputsDir, canonicalRunDir, canonicalOutputsDir);
    assertSnapshotMatches(outputsDir, outputsSnapshot, afterScan, true);
  } catch (error) {
    artifacts.splice(0);
    errors.push(`outputs: ${(error as Error).message}`);
  }

  for (const expected of contract.produces) {
    if (!expected.path) continue;
    const normalized = normalizeOutputPath(expected.path);
    const produced = artifacts.some(artifact => declaredPathMatches(normalized, relative(runDir, artifact.absolutePath)));
    if (!produced) warnings.push(`Expected ${normalized} was not produced`);
  }
  return { artifacts, warnings, errors };
}
