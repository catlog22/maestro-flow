import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
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
): { canonicalPath: string; stat: NonNullable<ReturnType<typeof lstatSync>> } | null {
  const stat = lstatSync(path);
  if (!stat || stat.isSymbolicLink()) return null;

  const canonicalPath = realpathSync(path);
  const expectedCanonicalPath = join(canonicalParent, basename(path));
  if (
    comparablePath(canonicalPath) !== comparablePath(expectedCanonicalPath)
    || !isPathContained(canonicalRoot, canonicalPath)
  ) return null;

  return { canonicalPath, stat };
}

export function hashFile(path: string): { hash: string; size: number } {
  const data = readFileSync(path);
  return { hash: createHash('sha256').update(data).digest('hex'), size: data.byteLength };
}

export function hashDirectory(path: string): { hash: string; size: number } {
  const hash = createHash('sha256');
  let size = 0;
  const canonicalRoot = realpathSync(path);
  const walk = (dir: string, canonicalDir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const inspected = inspectSafePath(full, canonicalDir, canonicalRoot);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) walk(full, inspected.canonicalPath, rel);
      else if (inspected.stat.isFile()) {
        const data = readFileSync(full);
        hash.update(rel).update('\0').update(data).update('\0');
        size += data.byteLength;
      }
    }
  };
  walk(path, canonicalRoot, '');
  return { hash: hash.digest('hex'), size };
}

function inferMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.md': return 'text/markdown';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.txt':
    case '.log': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

function markdownMeta(path: string): ArtifactMeta | null {
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
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

function declaredPathMatches(declaredPath: string, outputRelative: string): boolean {
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

function hasNestedDeclaredTemplate(contract: CommandContract, outputRelative: string): boolean {
  const prefix = `${normalizeOutputPath(outputRelative)}/`;
  return contract.produces.some(item => {
    if (!item.path) return false;
    const declared = normalizeOutputPath(item.path);
    return declared.includes('{') && declared.startsWith(prefix);
  });
}

function collectNestedFiles(directory: string, canonicalDirectory: string, canonicalRoot: string): string[] {
  const files: string[] = [];
  const walk = (current: string, canonicalCurrent: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const inspected = inspectSafePath(path, canonicalCurrent, canonicalRoot);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) walk(path, inspected.canonicalPath);
      else if (inspected.stat.isFile()) files.push(path);
    }
  };
  walk(directory, canonicalDirectory);
  return files;
}

export function scanOutputs(
  runDir: string,
  sessionDir: string,
  contract: CommandContract,
): ArtifactScanResult {
  const outputsDir = join(runDir, 'outputs');
  const artifacts: DiscoveredArtifact[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!existsSync(outputsDir)) return { artifacts, warnings, errors };

  const outputsStat = lstatSync(outputsDir);
  if (!outputsStat.isDirectory() || outputsStat.isSymbolicLink()) {
    for (const expected of contract.produces) {
      if (expected.path) warnings.push(`Expected ${normalizeOutputPath(expected.path)} was not produced`);
    }
    return { artifacts, warnings, errors };
  }
  const canonicalOutputsDir = realpathSync(outputsDir);

  const entries = readdirSync(outputsDir).sort();
  const candidates = entries.flatMap(name => {
    const absolutePath = join(outputsDir, name);
    const outputRelative = `outputs/${name}`;
    const inspected = inspectSafePath(absolutePath, canonicalOutputsDir, canonicalOutputsDir);
    if (!inspected) return [];
    if (!inspected.stat.isDirectory() || !hasNestedDeclaredTemplate(contract, outputRelative)) {
      return [absolutePath];
    }
    return collectNestedFiles(absolutePath, inspected.canonicalPath, canonicalOutputsDir)
      .filter(path => declaredProduce(contract, relative(runDir, path)));
  });
  const directJsonCount = candidates.filter(path => extname(path).toLowerCase() === '.json').length;
  for (const absolutePath of candidates) {
    const name = basename(absolutePath);
    const stat = statSync(absolutePath);
    const outputRelative = relative(runDir, absolutePath).replaceAll('\\', '/');
    const declared = declaredProduce(contract, outputRelative);
    let kind = declared?.kind ?? basename(name, extname(name));
    let schemaVersion = `${kind}/1.0`;
    let role: Artifact['role'] = declared?.primary ? 'primary' : 'attachment';
    let alias = declared?.alias;
    let warning: string | undefined;

    try {
      if (stat.isDirectory()) {
        kind = declared?.kind ?? `${name}-collection`;
        schemaVersion = `${kind}/1.0`;
      } else if (extname(name).toLowerCase() === '.json') {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
        const hasMeta = typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, '_meta');
        if (hasMeta) {
          const rawMeta = (parsed as { _meta: unknown })._meta;
          const result = artifactMetaSchema.safeParse(rawMeta);
          if (!result.success) {
            const detail = result.error.issues
              .map(issue => `${issue.path.join('.') || '_meta'}: ${issue.message}`)
              .join('; ');
            throw new Error(`invalid _meta; expected non-empty kind and schema${detail ? ` (${detail})` : ''}`);
          }
          const meta = result.data;
          kind = meta.kind;
          schemaVersion = meta.schema;
          role = meta.role ?? (directJsonCount === 1 ? 'primary' : role);
          alias = meta.alias ?? alias;
        } else {
          role = directJsonCount === 1 ? 'primary' : role;
          warning = `${outputRelative}: missing _meta; inferred kind=${kind}`;
        }
      } else if (extname(name).toLowerCase() === '.md') {
        const meta = markdownMeta(absolutePath);
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

      const hashed = stat.isDirectory() ? hashDirectory(absolutePath) : hashFile(absolutePath);
      const discovered: DiscoveredArtifact = {
        absolutePath,
        relativePath: relative(sessionDir, absolutePath).replaceAll('\\', '/'),
        kind,
        schemaVersion,
        role,
        alias,
        mediaType: stat.isDirectory() ? 'application/vnd.maestro.directory' : inferMediaType(absolutePath),
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

  for (const expected of contract.produces) {
    if (!expected.path) continue;
    const normalized = normalizeOutputPath(expected.path);
    const produced = artifacts.some(artifact => declaredPathMatches(normalized, relative(runDir, artifact.absolutePath)));
    if (!produced) warnings.push(`Expected ${normalized} was not produced`);
  }
  return { artifacts, warnings, errors };
}
