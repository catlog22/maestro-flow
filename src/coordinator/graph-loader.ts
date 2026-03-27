// ---------------------------------------------------------------------------
// Graph Loader — loads, validates, and caches ChainGraph JSON files.
// ---------------------------------------------------------------------------

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ChainGraph, GraphNode } from './graph-types.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  graph: ChainGraph;
  mtime: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof ChainGraph)[] = ['id', 'name', 'version', 'entry', 'nodes'];

function validateGraph(raw: unknown, filePath: string): ChainGraph {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GraphValidationError(`Invalid graph structure in ${filePath}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined) {
      throw new GraphValidationError(
        `Missing required field "${field}" in ${filePath}`,
      );
    }
  }

  if (typeof obj.nodes !== 'object' || obj.nodes === null || Array.isArray(obj.nodes)) {
    throw new GraphValidationError(`"nodes" must be an object in ${filePath}`);
  }

  const nodes = obj.nodes as Record<string, unknown>;
  const nodeIds = new Set(Object.keys(nodes));

  // entry must exist
  const entry = obj.entry as string;
  if (!nodeIds.has(entry)) {
    throw new GraphValidationError(
      `Entry node "${entry}" not found in nodes of ${filePath}`,
    );
  }

  // Validate all node references
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node === null || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    validateNodeRefs(nodeId, n, nodeIds, filePath);
  }

  return raw as unknown as ChainGraph;
}

function validateNodeRefs(
  nodeId: string,
  node: Record<string, unknown>,
  nodeIds: Set<string>,
  filePath: string,
): void {
  const check = (field: string, target: string) => {
    if (!nodeIds.has(target)) {
      throw new GraphValidationError(
        `Node "${nodeId}" references non-existent node "${target}" via "${field}" in ${filePath}`,
      );
    }
  };

  // next (command, join, eval)
  if (typeof node.next === 'string') check('next', node.next);

  // on_failure (command)
  if (typeof node.on_failure === 'string') check('on_failure', node.on_failure);

  // on_pass / on_fail (gate)
  if (typeof node.on_pass === 'string') check('on_pass', node.on_pass);
  if (typeof node.on_fail === 'string') check('on_fail', node.on_fail);

  // edges[].target (decision)
  if (Array.isArray(node.edges)) {
    for (const edge of node.edges) {
      if (edge && typeof edge === 'object' && typeof (edge as Record<string, unknown>).target === 'string') {
        check('edges[].target', (edge as Record<string, unknown>).target as string);
      }
    }
  }

  // branches + join (fork)
  if (Array.isArray(node.branches)) {
    for (const branch of node.branches) {
      if (typeof branch === 'string') check('branches[]', branch);
    }
  }
  if (node.type === 'fork' && typeof node.join === 'string') {
    check('join', node.join);
  }
}

// ---------------------------------------------------------------------------
// GraphLoader
// ---------------------------------------------------------------------------

export class GraphLoader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly chainsRoot: string) {}

  async load(graphId: string): Promise<ChainGraph> {
    const filePath = this.resolvePath(graphId);

    // Check mtime for cache
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      throw new GraphValidationError(`Graph file not found: ${filePath}`);
    }

    const mtime = fileStat.mtimeMs;
    const cached = this.cache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.graph;
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      throw new GraphValidationError(`Failed to read graph file: ${filePath}`);
    }

    const graph = this.parseAndValidate(content, filePath);
    this.cache.set(filePath, { graph, mtime });
    return graph;
  }

  loadSync(graphId: string): ChainGraph {
    const filePath = this.resolvePath(graphId);

    let fileStat;
    try {
      fileStat = statSync(filePath);
    } catch {
      throw new GraphValidationError(`Graph file not found: ${filePath}`);
    }

    const mtime = fileStat.mtimeMs;
    const cached = this.cache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.graph;
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      throw new GraphValidationError(`Failed to read graph file: ${filePath}`);
    }

    const graph = this.parseAndValidate(content, filePath);
    this.cache.set(filePath, { graph, mtime });
    return graph;
  }

  listAll(): string[] {
    const results: string[] = [];
    this.walkDir(this.chainsRoot, results);
    return results.sort();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private resolvePath(graphId: string): string {
    return join(this.chainsRoot, `${graphId}.json`);
  }

  private parseAndValidate(content: string, filePath: string): ChainGraph {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new GraphValidationError(`Invalid JSON in ${filePath}`);
    }
    return validateGraph(raw, filePath);
  }

  private walkDir(dir: string, results: string[]): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const rel = relative(this.chainsRoot, fullPath);
        // Convert to forward-slash graph ID without .json
        const graphId = rel.replace(/\.json$/, '').split(sep).join('/');
        results.push(graphId);
      }
    }
  }
}
