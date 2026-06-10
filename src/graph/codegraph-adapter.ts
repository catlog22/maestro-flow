/**
 * Adapter to use @colbymchenry/codegraph as the extraction engine.
 *
 * CodeGraph provides tree-sitter-based (WASM) code parsing with support for
 * 19 languages and 21 framework resolvers. This adapter wraps its API for
 * Maestro's use, translating between the two type systems.
 *
 * Falls back gracefully when the package is not installed: callers should
 * check isAvailable() or isCodeGraphAvailable() before calling index/sync.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Result types adapted for Maestro consumption
// ---------------------------------------------------------------------------

export interface CodeGraphIndexResult {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  errors: Array<{ message: string; filePath?: string; severity: string }>;
}

export interface CodeGraphSyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths?: string[];
}

export interface CodeGraphStatsResult {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Progress callback (mirrors CodeGraph's IndexProgress)
// ---------------------------------------------------------------------------

export interface CodeGraphProgress {
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving';
  current: number;
  total: number;
  currentFile?: string;
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

export class CodeGraphAdapter {
  private projectRoot: string;
  private cgInstance: unknown | null = null;
  private available: boolean | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Check if the @colbymchenry/codegraph package can be loaded.
   * Result is cached after the first successful probe.
   */
  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    try {
      require('@colbymchenry/codegraph');
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /**
   * Full project indexing with tree-sitter extraction.
   *
   * If the project has not been initialized with CodeGraph yet, this will
   * call `CodeGraph.init()` (which creates the `.codegraph/` directory and
   * database). Otherwise it opens the existing project and runs `indexAll()`.
   */
  async index(options?: {
    onProgress?: (progress: CodeGraphProgress) => void;
    signal?: AbortSignal;
    verbose?: boolean;
  }): Promise<CodeGraphIndexResult> {
    const cg = await this.ensureInstance(/* forWrite */ true);

    const result = await cg.indexAll({
      onProgress: options?.onProgress,
      signal: options?.signal,
      verbose: options?.verbose,
    });

    // Run reference resolution after indexing for full edge coverage
    cg.resolveReferences();

    return {
      success: result.success,
      filesIndexed: result.filesIndexed,
      filesSkipped: result.filesSkipped,
      filesErrored: result.filesErrored,
      nodeCount: result.nodesCreated,
      edgeCount: result.edgesCreated,
      durationMs: result.durationMs,
      errors: result.errors.map((e: { message: string; filePath?: string; severity: string }) => ({
        message: e.message,
        filePath: e.filePath,
        severity: e.severity,
      })),
    };
  }

  /**
   * Incremental sync -- re-index only changed files.
   */
  async sync(options?: {
    onProgress?: (progress: CodeGraphProgress) => void;
  }): Promise<CodeGraphSyncResult> {
    const cg = await this.ensureInstance(/* forWrite */ true);

    const result = await cg.sync({
      onProgress: options?.onProgress,
    });

    return {
      filesChecked: result.filesChecked,
      filesAdded: result.filesAdded,
      filesModified: result.filesModified,
      filesRemoved: result.filesRemoved,
      nodesUpdated: result.nodesUpdated,
      durationMs: result.durationMs,
      changedFilePaths: result.changedFilePaths,
    };
  }

  /**
   * Get graph statistics.
   */
  async stats(): Promise<CodeGraphStatsResult> {
    const cg = await this.ensureInstance(/* forWrite */ false);
    const s = cg.getStats();

    return {
      nodeCount: s.nodeCount,
      edgeCount: s.edgeCount,
      fileCount: s.fileCount,
      nodesByKind: s.nodesByKind,
      edgesByKind: s.edgesByKind,
      filesByLanguage: s.filesByLanguage,
      dbSizeBytes: s.dbSizeBytes,
    };
  }

  /**
   * Get detected frameworks in the project (e.g. "express", "react", "nestjs").
   */
  async getDetectedFrameworks(): Promise<string[]> {
    const cg = await this.ensureInstance(/* forWrite */ false);
    return cg.getDetectedFrameworks();
  }

  /**
   * Check whether this project has already been initialized by CodeGraph
   * (i.e. `.codegraph/` directory and database exist).
   */
  isInitialized(): boolean {
    if (!this.isAvailable()) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isInitialized } = require('@colbymchenry/codegraph');
    return isInitialized(this.projectRoot);
  }

  /**
   * Resolve a Maestro-style node ID (e.g. "function:tools/spec-loader.ts:loadSpecs")
   * to a CodeGraph node. Also accepts CodeGraph hash-based IDs directly.
   *
   * Returns the full CodeGraph node object, or null if not found.
   */
  async resolveNode(maestroId: string): Promise<any | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);

    // Try direct lookup first (handles CodeGraph native IDs)
    const direct = cg.getNode(maestroId);
    if (direct) return direct;

    // Parse Maestro-style ID: "kind:filePath:name"
    const parts = maestroId.split(':');
    if (parts.length < 3) return null;

    const kind = parts[0];
    const name = parts[parts.length - 1];
    const filePath = parts.slice(1, -1).join(':');

    // Search by name and filter by kind + file path
    const results = cg.searchNodes(name, { limit: 50 });
    for (const r of results) {
      const node = r.node ?? r;
      if (
        node.name === name &&
        node.kind === kind &&
        node.filePath &&
        (node.filePath === filePath || node.filePath.endsWith(filePath) || filePath.endsWith(node.filePath))
      ) {
        return node;
      }
    }

    // Fallback: less strict match (name + kind only)
    for (const r of results) {
      const node = r.node ?? r;
      if (node.name === name && node.kind === kind) {
        return node;
      }
    }

    return null;
  }

  /**
   * Get callers of a node, accepting either CodeGraph or Maestro-style IDs.
   */
  async getCallers(nodeId: string, maxDepth = 2): Promise<Array<{ node: any; edge: any }>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);
    const resolved = await this.resolveNode(nodeId);
    if (!resolved) return [];
    return cg.getCallers(resolved.id, maxDepth);
  }

  /**
   * Get callees of a node, accepting either CodeGraph or Maestro-style IDs.
   */
  async getCallees(nodeId: string, maxDepth = 2): Promise<Array<{ node: any; edge: any }>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);
    const resolved = await this.resolveNode(nodeId);
    if (!resolved) return [];
    return cg.getCallees(resolved.id, maxDepth);
  }

  /**
   * Get full context for a node (CodeGraph's getContext).
   */
  async getContext(nodeId: string): Promise<any | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);
    const resolved = await this.resolveNode(nodeId);
    if (!resolved) return null;
    return cg.getContext(resolved.id);
  }

  /**
   * Search nodes in the CodeGraph index.
   */
  async searchNodes(query: string, options?: { limit?: number; kinds?: string[] }): Promise<Array<{ node: any; score: number }>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);
    return cg.searchNodes(query, options);
  }

  /**
   * Get nodes in a specific file.
   */
  async getNodesInFile(filePath: string): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const cg = await this.ensureInstance(/* forWrite */ false);
    return cg.getNodesInFile(filePath);
  }

  /**
   * Release the underlying CodeGraph instance and database connection.
   */
  close(): void {
    if (this.cgInstance) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.cgInstance as any).close();
      this.cgInstance = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Ensure we have a live CodeGraph instance.
   *
   * - If the project is already initialized, opens it.
   * - If `forWrite` and not initialized, initializes a fresh project.
   * - If `!forWrite` and not initialized, throws.
   */
  private async ensureInstance(forWrite: boolean): Promise</* CodeGraph */ any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (this.cgInstance) return this.cgInstance;

    // Use createRequire (defined at module level) for consistent CJS interop.
    // Dynamic `await import()` wraps CJS differently than `require()`.
    const pkg = require('@colbymchenry/codegraph');
    const CG = pkg.CodeGraph as {
      init(root: string, opts?: unknown): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      open(root: string, opts?: unknown): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      isInitialized(root: string): boolean;
    };
    const initialized = (pkg.isInitialized as (root: string) => boolean)(this.projectRoot);

    if (initialized) {
      this.cgInstance = await CG.open(this.projectRoot);
    } else if (forWrite) {
      this.cgInstance = await CG.init(this.projectRoot);
    } else {
      throw new Error(
        `CodeGraph not initialized for ${this.projectRoot}. ` +
        'Run "maestro kg index" first to create the index.',
      );
    }

    return this.cgInstance;
  }
}

// ---------------------------------------------------------------------------
// Standalone availability check (no instance needed)
// ---------------------------------------------------------------------------

let _cachedAvailable: boolean | null = null;

/**
 * Check if @colbymchenry/codegraph can be loaded in this environment.
 * Useful for feature-gating without instantiating a full adapter.
 */
export function isCodeGraphAvailable(): boolean {
  if (_cachedAvailable !== null) return _cachedAvailable;
  try {
    require('@colbymchenry/codegraph');
    _cachedAvailable = true;
  } catch {
    _cachedAvailable = false;
  }
  return _cachedAvailable;
}
