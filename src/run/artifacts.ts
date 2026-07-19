import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

export function hashFile(path: string): { hash: string; size: number } {
  const data = readFileSync(path);
  return { hash: createHash('sha256').update(data).digest('hex'), size: data.byteLength };
}

export function hashDirectory(path: string): { hash: string; size: number } {
  const hash = createHash('sha256');
  let size = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile()) {
        const data = readFileSync(full);
        hash.update(rel).update('\0').update(data).update('\0');
        size += data.byteLength;
      }
    }
  };
  walk(path, '');
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
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  const normalized = normalize(outputRelative);
  return contract.produces.find(item => item.path && normalize(item.path) === normalized);
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

  const entries = readdirSync(outputsDir).sort();
  const directJsonCount = entries.filter(name => extname(name).toLowerCase() === '.json').length;
  for (const name of entries) {
    const absolutePath = join(outputsDir, name);
    const stat = statSync(absolutePath);
    const outputRelative = `outputs/${name}`;
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
    const normalized = expected.path.replace(/^\.\//, '').replace(/\/$/, '');
    if (!existsSync(join(runDir, normalized))) warnings.push(`Expected ${normalized} was not produced`);
  }
  return { artifacts, warnings, errors };
}
