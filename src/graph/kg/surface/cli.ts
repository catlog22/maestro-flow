// src/graph/kg/surface/cli.ts — maestro kg CLI 命令注册
// 参考: plan-maestrograph.md CLI 命令设计 + src/commands/kg.ts (现有命令)

import type { Command } from 'commander';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { MaestroGraph, makeNodeResolutionErrorPayload } from '../engine.js';
import { searchUnified, parseQuery } from '../query/search.js';
import { bfs, normalizeTraversalDepth } from '../query/traversal.js';
import type {
  HierarchyDirection,
  ImpactResult,
  PathSearchResult,
  TypeHierarchyResult,
} from '../query/traversal.js';
import { buildContext } from '../query/context-builder.js';
import { syncKnowledgeGraph, type CodegraphSyncOptions } from '../extraction/orchestrator.js';
import { KG_SCHEMA_VERSION, getKgDatabasePath } from '../db/connection.js';
import { SOURCE_TYPES, type UnifiedNode, type SourceType } from '../db/types.js';
import { validateExternalSurfaceManifest } from '../extraction/code/external/external-surface-manifest.js';
import {
  resolveExternalSurfaceProjectRoot,
  resolveKgCliProjectRoot,
} from './project-root.js';

function parseCsv(value: string | undefined): string[] | undefined {
  return value
    ? value.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined;
}

function normalizeSources(value: string | undefined): SourceType[] | undefined {
  const sources = parseCsv(value);
  if (!sources) return undefined;
  const valid = new Set<string>(SOURCE_TYPES);
  const invalid = sources.filter(source => !valid.has(source));
  if (invalid.length > 0) throw new Error(`Unsupported MaestroGraph source type(s): ${invalid.join(', ')}`);
  return [...new Set(sources)] as SourceType[];
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(candidate, max));
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeCodegraphOptions(opts: {
  src?: string;
  includeTests?: boolean;
  maxFileSize?: string;
  excludeDir?: string;
  excludeFile?: string;
  noCreateMaestroIgnore?: boolean;
  allowExtractorScripts?: boolean;
}): CodegraphSyncOptions | undefined {
  const srcDirs = parseCsv(opts.src);
  const excludeDirs = parseCsv(opts.excludeDir);
  const excludeFiles = parseCsv(opts.excludeFile);
  const maxFileSize = parseInteger(opts.maxFileSize);
  if (!srcDirs && !excludeDirs && !excludeFiles && !maxFileSize && !opts.includeTests && !opts.noCreateMaestroIgnore && !opts.allowExtractorScripts) {
    return undefined;
  }
  return {
    srcDirs,
    excludeDirs,
    excludeFiles,
    maxFileSize,
    includeTests: opts.includeTests,
    createMaestroIgnore: opts.noCreateMaestroIgnore ? false : undefined,
    allowExtractorScripts: opts.allowExtractorScripts,
  };
}

function printSyncResults(results: Awaited<ReturnType<typeof syncKnowledgeGraph>>): void {
  let totalNodes = 0;
  let totalEdges = 0;
  for (const r of results) {
    totalNodes += r.nodesAdded;
    totalEdges += r.edgesAdded;
    console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
    if (r.coverage && r.coverage.filesUnsupported > 0) {
      const listed = Object.entries(r.coverage.unsupportedExtensions)
        .map(([ext, count]) => `${ext}:${count}`)
        .join(' ');
      console.log(`    coverage: ${r.coverage.filesScanned} scannable, ${r.coverage.filesUnsupported} skipped by extension [${listed}]`);
    }
    if (r.coverage && r.coverage.filesPartialParse > 0) {
      console.log(`    coverage: ${r.coverage.filesPartialParse}/${r.coverage.filesScanned} file(s) parsed with a non-fatal grammar gap`);
    }
  }
  console.log(`\nTotal: ${totalNodes} nodes, ${totalEdges} edges`);
}

/**
 * 只有当调用方用 `--src` 明确指定“这里是我的代码”、而一个文件都没被识别为受支持
 * 语言时，才把结果当失败。没有 `--src` 的仓库可能本来就只有文档，那时索引为空是
 * 正确结果而不是故障 —— 用意图信号代替“这个扩展名像不像源码”的启发式。
 */
function codegraphIntentFailed(
  results: Awaited<ReturnType<typeof syncKnowledgeGraph>>,
  explicitSrc: boolean,
): boolean {
  if (!explicitSrc) return false;
  const codegraph = results.find(r => r.source === 'codegraph');
  if (!codegraph) return false;
  return (codegraph.nodesAdded ?? 0) === 0
    && (codegraph.coverage?.filesScanned ?? 0) === 0
    && (codegraph.coverage?.filesUnsupported ?? 0) > 0;
}

async function syncProject(
  opts: {
    full?: boolean;
    source?: string;
    json?: boolean;
    src?: string;
    includeTests?: boolean;
    maxFileSize?: string;
    excludeDir?: string;
    excludeFile?: string;
    noCreateMaestroIgnore?: boolean;
    allowExtractorScripts?: boolean;
  },
  label = 'Syncing MaestroGraph...',
): Promise<void> {
  const projectRoot = resolveKgCliProjectRoot();
  const sources = normalizeSources(opts.source);
  const codegraph = normalizeCodegraphOptions(opts);

  if (!opts.json) console.log(label);
  const results = await syncKnowledgeGraph(projectRoot, {
    full: opts.full,
    sources,
    codegraph,
  });

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    if (codegraphIntentFailed(results, Boolean(opts.src))) process.exitCode = 1;
    return;
  }

  printSyncResults(results);
  if (codegraphIntentFailed(results, Boolean(opts.src))) {
    console.error('  codegraph: --src was given but no file matched a registered language.');
    process.exitCode = 1;
  }
}

async function openGraph(): Promise<MaestroGraph> {
  const projectRoot = resolveKgCliProjectRoot();
  if (!MaestroGraph.isInitialized(projectRoot)) {
    console.error('MaestroGraph not initialized for this project.');
    console.error('  Run: maestro kg sync');
    process.exit(1);
  }
  return MaestroGraph.open(projectRoot);
}

function formatNodeLabel(node: UnifiedNode): string {
  const loc = node.filePath ? ` ${node.filePath}:${node.startLine}` : '';
  const detail = node.signature || node.definition;
  const suffix = detail ? ` -- ${detail.substring(0, 80)}` : '';
  return `[${node.sourceType}:${node.kind}] ${node.name}${loc}${suffix}`;
}

function resolveNodeOrExit(mg: MaestroGraph, query: string, json = false): UnifiedNode | null {
  const resolution = mg.resolveNode(query);
  if (resolution.status === 'resolved') return resolution.node;

  const error = makeNodeResolutionErrorPayload(resolution);
  if (json) {
    console.log(JSON.stringify({ error }, null, 2));
  } else if (resolution.status === 'ambiguous') {
    console.error(`Ambiguous node: ${query}`);
    for (const id of error.candidates) console.error(`  ${id}`);
  } else {
    console.error(`Node not found: ${query}`);
  }
  process.exitCode = 1;
  return null;
}

function compareBytes(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function serializeNode(node: UnifiedNode): Pick<UnifiedNode, 'id' | 'kind' | 'name' | 'qualifiedName' | 'language'> {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    language: node.language,
  };
}

function serializeHierarchy(result: TypeHierarchyResult): Record<string, unknown> {
  return {
    root: result.root ? serializeNode(result.root) : null,
    parents: result.parents.map(serializeNode),
    children: result.children.map(serializeNode),
    rawEdges: result.rawEdges,
    depth: result.depth,
    direction: result.direction,
    truncated: result.truncated,
  };
}

function serializeImpact(nodeId: string, result: ImpactResult): Record<string, unknown> {
  return {
    node: nodeId,
    nodeCount: result.nodes.size,
    edgeCount: result.edges.length,
    depth: result.depth,
    traversalDirection: result.traversalDirection,
    truncated: result.truncated,
    nodes: [...result.nodes.values()]
      .sort((left, right) => compareBytes(left.id, right.id))
      .map(serializeNode),
    edges: result.edges,
  };
}

function serializePath(fromId: string, toId: string, result: PathSearchResult): Record<string, unknown> {
  return {
    from: fromId,
    to: toId,
    hops: result.path ? Math.max(0, result.path.length - 1) : null,
    path: result.path,
    truncated: result.truncated,
    visitedCount: result.visitedCount,
  };
}

// ---------------------------------------------------------------------------
// 注册 maestro kg 子命令
// ---------------------------------------------------------------------------

export function registerKgCommands(program: Command): void {
  const kg = program
    .command('kg')
    .description('Unified knowledge graph — query, sync, and manage MaestroGraph');

  // ── init ──────────────────────────────────────────────────────────
  kg
    .command('init')
    .description('Initialize MaestroGraph database (.workflow/kg/maestro.db)')
    .action(async () => {
      const projectRoot = resolveKgCliProjectRoot();
      if (MaestroGraph.isInitialized(projectRoot)) {
        console.log('MaestroGraph already initialized.');
        return;
      }
      const mg = await MaestroGraph.init(projectRoot);
      const stats = mg.getStats();
      console.log(`MaestroGraph initialized: ${stats.dbSizeBytes} bytes, schema v${stats.schemaVersion}`);
      mg.close();
    });

  // ── sync ──────────────────────────────────────────────────────────
  kg
    .command('sync')
    .description('Sync knowledge graph — extract from all sources')
    .option('--full', 'Full rebuild (ignore file hashes)')
    .option('--source <sources>', 'Comma-separated sources: domain,spec,knowhow,codebase,issue,codegraph')
    .option('--src <paths>', 'Comma-separated code source roots for codegraph source')
    .option('--max-file-size <bytes>', 'Maximum code file size to index')
    .option('--include-tests', 'Include test files in code index')
    .option('--exclude-dir <patterns>', 'Comma-separated directory ignore patterns')
    .option('--exclude-file <patterns>', 'Comma-separated file ignore patterns')
    .option('--no-create-maestro-ignore', 'Do not create .maestroignore when missing')
    .option('--allow-extractor-scripts', 'Allow execution of .mjs extractor plugins')
    .option('--json', 'Output as JSON')
    .option('--incremental', 'Incremental sync (compatibility alias — sync is already hash-aware)')
    .action(async (opts) => syncProject(opts));

  kg
    .command('sync-all')
    .description('Compatibility alias for sync — sync all MaestroGraph sources')
    .option('--full', 'Full rebuild (ignore file hashes)')
    .option('--source <sources>', 'Comma-separated sources: domain,spec,knowhow,codebase,issue,codegraph')
    .option('--src <paths>', 'Comma-separated code source roots for codegraph source')
    .option('--max-file-size <bytes>', 'Maximum code file size to index')
    .option('--include-tests', 'Include test files in code index')
    .option('--exclude-dir <patterns>', 'Comma-separated directory ignore patterns')
    .option('--exclude-file <patterns>', 'Comma-separated file ignore patterns')
    .option('--no-create-maestro-ignore', 'Do not create .maestroignore when missing')
    .option('--allow-extractor-scripts', 'Allow execution of .mjs extractor plugins')
    .option('--json', 'Output as JSON')
    .action(async (opts) => syncProject(opts, 'Syncing MaestroGraph (all knowledge sources)...'));

  kg
    .command('index')
    .description('Compatibility alias for sync --source codegraph')
    .option('--src <paths>', 'Comma-separated code source roots to index')
    .option('--max-file-size <bytes>', 'Maximum code file size to index')
    .option('--include-tests', 'Include test files in code index')
    .option('--exclude-dir <patterns>', 'Comma-separated directory ignore patterns')
    .option('--exclude-file <patterns>', 'Comma-separated file ignore patterns')
    .option('--no-create-maestro-ignore', 'Do not create .maestroignore when missing')
    .option('--allow-extractor-scripts', 'Allow execution of .mjs extractor plugins')
    .option('--json', 'Output as JSON')
    .action(async (opts) => syncProject({ ...opts, source: 'codegraph' }, 'Indexing code with MaestroGraph...'));

  // ── exact external surfaces ──────────────────────────────────────
  const externalSurfaces = kg
    .command('external-surfaces')
    .description('Manage the fixed exact-file external surface allowlist');

  externalSurfaces
    .command('validate')
    .description('Validate .workflow/kg/external-surfaces.json without indexing')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const validation = validateExternalSurfaceManifest(resolveExternalSurfaceProjectRoot());
      const output = {
        schemaVersion: validation.schemaVersion,
        configPath: validation.configPath,
        configured: validation.configured,
        resolved: validation.resolved,
        errors: validation.errors,
        digest: validation.digest,
      };

      if (opts.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (validation.errors.length > 0) {
        console.error(`External surface manifest is invalid: ${validation.configPath}`);
        for (const error of validation.errors) {
          console.error(`  ${error.code}: ${error.message}`);
        }
      } else {
        console.log(`External surfaces: ${validation.configured} configured, ${validation.resolved} resolved`);
        console.log(`Config: ${validation.configPath}`);
      }

      if (validation.errors.length > 0) process.exitCode = 1;
    });

  // ── query ─────────────────────────────────────────────────────────
  kg
    .command('query <text>')
    .description('Search across all knowledge layers')
    .option('--source <types>', 'Filter by source type (comma-separated)')
    .option('--kind <types>', 'Filter by node kind')
    .option('--depth <n>', 'Graph traversal depth', '1')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (text: string, opts) => {
      const mg = await MaestroGraph.open(resolveKgCliProjectRoot());
      try {
        const parsed = parseQuery(text);
        const sourceTypes = normalizeSources(opts.source)
          ?? (parsed.sourceTypes.length > 0 ? parsed.sourceTypes : undefined);
        const kinds = opts.kind?.split(',')
          ?? (parsed.kinds.length > 0 ? parsed.kinds : undefined);
        const effectiveText = parsed.text || text;

        const output = mg.searchUnified(effectiveText, {
          sourceTypes: sourceTypes as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          kinds: kinds as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          limit: clampInteger(opts.limit, 20, 1, 500),
        });
        const results = output.directMatches;
        const depth = clampInteger(opts.depth, 1, 0, 5);
        const related = new Map<string, UnifiedNode>();
        if (depth > 0) {
          for (const result of results) {
            const traversal = bfs(mg.getQueryBuilder(), result.node.id, { maxDepth: depth, maxNodes: 50 });
            for (const [id, node] of traversal.nodes) {
              if (id !== result.node.id) related.set(id, node);
            }
          }
        }

        if (opts.json) {
          console.log(JSON.stringify({ query: text, parsed: { text: effectiveText, kinds, sourceTypes }, results: results.map(r => ({
            id: r.node.id, kind: r.node.kind, name: r.node.name, sourceType: r.node.sourceType,
            definition: r.node.definition.substring(0, 200), score: r.score,
          })), related: [...related.values()].map(node => ({
            id: node.id, kind: node.kind, name: node.name, sourceType: node.sourceType,
          })), summary: { ...output.summary, traversalDepth: depth, relatedNodes: related.size } }, null, 2));
          return;
        }

        console.log(`Query: "${effectiveText}" (${results.length} results)`);
        for (const r of results) {
          const def = r.node.definition ? ` — ${r.node.definition.substring(0, 80)}` : '';
          const scoreTag = r.score > 0 ? `  (${r.score.toFixed(1)})` : '';
          console.log(`  [${r.node.sourceType}:${r.node.kind}] ${r.node.name}${def}${scoreTag}`);
        }
        if (related.size > 0) console.log(`Related (${depth}-hop): ${related.size}`);
      } finally {
        mg.close();
      }
    });

  kg
    .command('search <text>')
    .description('[deprecated] Use "maestro search --kg" instead')
    .option('--source <types>', 'Filter by source type (comma-separated)')
    .option('--kind <types>', 'Filter by node kind')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (text: string, opts) => {
      console.warn('[deprecated] Use "maestro search --kg" instead');
      const mg = await openGraph();
      try {
        const parsed = parseQuery(text);
        const sourceTypes = parseCsv(opts.source) ?? (parsed.sourceTypes.length > 0 ? parsed.sourceTypes : undefined);
        const kinds = parseCsv(opts.kind) ?? (parsed.kinds.length > 0 ? parsed.kinds : undefined);
        const effectiveText = parsed.text || text;
        const output = mg.searchUnified(effectiveText, {
          sourceTypes: sourceTypes as SourceType[] | undefined,
          kinds,
          limit: clampInteger(opts.limit, 20, 1, 500),
        });

        if (opts.json) {
          console.log(JSON.stringify({
            query: text,
            total: output.directMatches.length,
            nodes: output.directMatches.map(r => ({ ...r.node, score: r.score })),
            engine: 'maestrograph',
          }, null, 2));
          return;
        }

        console.log(`Search: "${effectiveText}"  (${output.directMatches.length} results, MaestroGraph)`);
        for (const r of output.directMatches) {
          console.log(`  ${r.node.id}  ${formatNodeLabel(r.node)}  (${r.score.toFixed(1)})`);
        }
      } finally {
        mg.close();
      }
    });

  // ── context ───────────────────────────────────────────────────────
  kg
    .command('context <node>')
    .description('Show full context for a node id or symbol name (all related layers)')
    .option('--depth <n>', 'Graph traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery, Boolean(opts.json));
        if (!node) return;

        const traversal = mg.traverse(node.id, {
          maxDepth: Math.min(Number(opts.depth) || 1, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify({
            node: { id: node.id, kind: node.kind, name: node.name, sourceType: node.sourceType },
            related: [...traversal.nodes.values()].map(n => ({
              id: n.id, kind: n.kind, name: n.name, sourceType: n.sourceType,
            })),
            edges: traversal.edges,
            resolvedFrom: nodeQuery,
          }, null, 2));
          return;
        }

        if (node.id !== nodeQuery) console.log(`Resolved "${nodeQuery}" -> ${node.id}`);
        console.log(`Node: [${node.sourceType}:${node.kind}] ${node.name}`);
        if (node.definition) console.log(`  Definition: ${node.definition}`);
        if (node.filePath) console.log(`  File: ${node.filePath}:${node.startLine}`);

        if (traversal.nodes.size > 1) {
          console.log(`\nRelated (${traversal.nodes.size - 1}):`);
          for (const [id, related] of traversal.nodes) {
            if (id === node.id) continue;
            console.log(`  [${related.sourceType}:${related.kind}] ${related.name}`);
          }
        }
      } finally {
        mg.close();
      }
    });

  // ── hierarchy ─────────────────────────────────────────────────────
  kg
    .command('hierarchy <node>')
    .description('Show inheritance parents and children for a node')
    .option('--direction <direction>', 'parents, children, or both', 'both')
    .option('--depth <n>', 'Max hierarchy depth', '3')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const direction = String(opts.direction) as HierarchyDirection;
        if (!['parents', 'children', 'both'].includes(direction)) {
          if (opts.json) {
            console.log(JSON.stringify({
              error: {
                code: 'invalid_hierarchy_direction',
                direction: opts.direction,
                allowed: ['parents', 'children', 'both'],
              },
            }, null, 2));
          } else {
            console.error(`Invalid hierarchy direction: ${String(opts.direction)}`);
          }
          process.exitCode = 1;
          return;
        }
        const node = resolveNodeOrExit(mg, nodeQuery, Boolean(opts.json));
        if (!node) return;
        const hierarchy = mg.getTypeHierarchy(node.id, {
          direction,
          depth: normalizeTraversalDepth(opts.depth, 3, 20),
          maxNodes: 1_000,
        });

        if (opts.json) {
          console.log(JSON.stringify(serializeHierarchy(hierarchy), null, 2));
          return;
        }

        console.log(`Hierarchy for ${node.id} (${direction}, depth ${hierarchy.depth})`);
        if (direction !== 'children') {
          console.log(`Parents (${hierarchy.parents.length}):`);
          for (const parent of hierarchy.parents) console.log(`  ${formatNodeLabel(parent)}`);
        }
        if (direction !== 'parents') {
          console.log(`Children (${hierarchy.children.length}):`);
          for (const child of hierarchy.children) console.log(`  ${formatNodeLabel(child)}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── path ──────────────────────────────────────────────────────────
  kg
    .command('path <from> <to>')
    .description('Find shortest path between exact IDs, qualified names, or unique simple names')
    .option('--depth <n>', 'Max path depth', '10')
    .option('--json', 'Output as JSON')
    .action(async (fromQuery: string, toQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const from = resolveNodeOrExit(mg, fromQuery, Boolean(opts.json));
        if (!from) return;
        const to = resolveNodeOrExit(mg, toQuery, Boolean(opts.json));
        if (!to) return;
        const pathResult = mg.findShortestPathResult(
          from.id,
          to.id,
          normalizeTraversalDepth(opts.depth, 10, 50),
          1_000,
        );
        const path = pathResult.path;

        if (opts.json) {
          console.log(JSON.stringify(serializePath(from.id, to.id, pathResult), null, 2));
          if (pathResult.truncated) process.exitCode = 1;
          return;
        }

        if (!path) {
          if (pathResult.truncated) {
            console.error(`Path search truncated after ${pathResult.visitedCount} nodes; no absence conclusion is available.`);
            process.exitCode = 1;
          } else {
            console.log(`No path found from ${from.id} to ${to.id}`);
          }
        } else {
          console.log(`Path (${Math.max(0, path.length - 1)} hops):`);
          const first = mg.getNode(path[0].nodeId);
          console.log(`  [${first?.sourceType ?? '?'}:${first?.kind ?? '?'}] ${first?.name ?? path[0].nodeId}`);
          for (const step of path.slice(1)) {
            const pathNode = mg.getNode(step.nodeId);
            const connector = step.traversalDirection === 'outgoing'
              ? `--[${step.edge?.kind ?? '?'}]-->`
              : `<--[${step.edge?.kind ?? '?'}]--`;
            console.log(`  ${connector} [${pathNode?.sourceType ?? '?'}:${pathNode?.kind ?? '?'}] ${pathNode?.name ?? step.nodeId}`);
          }
        }
      } finally {
        mg.close();
      }
    });

  // ── callers ───────────────────────────────────────────────────────
  kg
    .command('callers <node>')
    .description('Show callers of a function/method by node id or symbol name')
    .option('--depth <n>', 'Traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery, Boolean(opts.json));
        if (!node) return;
        const callers = mg.getCallers(node.id, Math.min(Number(opts.depth) || 1, 10));

        if (opts.json) {
          console.log(JSON.stringify({ node: node.id, callers: callers.map(c => ({
            id: c.node.id, name: c.node.name, kind: c.node.kind, edgeKind: c.edge.kind,
          })) }, null, 2));
          return;
        }

        console.log(`Callers of ${node.id} (${callers.length}):`);
        for (const { node, edge } of callers) {
          console.log(`  ${formatNodeLabel(node)} --${edge.kind}-->`);
        }
      } finally {
        mg.close();
      }
    });

  // ── callees ───────────────────────────────────────────────────────
  kg
    .command('callees <node>')
    .description('Show callees of a function/method by node id or symbol name')
    .option('--depth <n>', 'Traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery, Boolean(opts.json));
        if (!node) return;
        const callees = mg.getCallees(node.id, Math.min(Number(opts.depth) || 1, 10));

        if (opts.json) {
          console.log(JSON.stringify({ node: node.id, callees: callees.map(c => ({
            id: c.node.id, name: c.node.name, kind: c.node.kind, edgeKind: c.edge.kind,
          })) }, null, 2));
          return;
        }

        console.log(`Callees of ${node.id} (${callees.length}):`);
        for (const { node, edge } of callees) {
          console.log(`  --${edge.kind}--> ${formatNodeLabel(node)}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── impact ────────────────────────────────────────────────────────
  kg
    .command('impact <node>')
    .description('Show transitive impact radius by node id or symbol name')
    .option('--depth <n>', 'Max depth', '3')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery, Boolean(opts.json));
        if (!node) return;
        const impact = mg.getImpact(
          node.id,
          normalizeTraversalDepth(opts.depth, 3, 10),
          'incoming',
        );

        if (opts.json) {
          console.log(JSON.stringify(serializeImpact(node.id, impact), null, 2));
          return;
        }

        console.log(`Impact radius for ${node.id}: ${impact.nodes.size} nodes, ${impact.edges.length} edges (${impact.traversalDirection})`);
        for (const related of impact.nodes.values()) {
          if (related.id === node.id) continue;
          console.log(`  ${formatNodeLabel(related)}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── stats ─────────────────────────────────────────────────────────
  kg
    .command('stats')
    .description('Show knowledge graph statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const mg = await MaestroGraph.open(resolveKgCliProjectRoot());
      try {
        const stats = mg.getStats();

        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        console.log('MaestroGraph Statistics');
        console.log('─'.repeat(40));
        console.log(`Nodes: ${stats.nodeCount}`);
        for (const [kind, count] of Object.entries(stats.nodesByKind)) {
          console.log(`  ${kind}: ${count}`);
        }
        console.log(`\nEdges: ${stats.edgeCount}`);
        for (const [kind, count] of Object.entries(stats.edgesByKind)) {
          console.log(`  ${kind}: ${count}`);
        }
        console.log(`\nBy source:`);
        for (const [source, count] of Object.entries(stats.nodesBySourceType)) {
          console.log(`  ${source}: ${count}`);
        }
        console.log(`\nFiles: ${stats.fileCount}`);
        console.log(`DB size: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`Schema: v${stats.schemaVersion}`);
        console.log(`Staleness: ${(stats.stalenessRatio * 100).toFixed(1)}%`);
        console.log(`Structural refs: ${stats.structuralRefs?.total ?? 0}`);
        for (const [status, count] of Object.entries(stats.structuralRefs?.status ?? {})) {
          console.log(`  ${status}: ${count}`);
        }
        console.log(`External nodes: ${stats.externalNodes?.total ?? 0}`);
        console.log(`  apple catalog: ${stats.externalNodes?.appleCatalog ?? 0}`);
        console.log(`  exact surfaces: ${stats.externalNodes?.exactSurfaces ?? 0}`);
        if (stats.detectedFrameworks.length > 0) {
          console.log(`Frameworks: ${stats.detectedFrameworks.join(', ')}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── health ────────────────────────────────────────────────────────
  kg
    .command('health')
    .description('Check knowledge graph health')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const projectRoot = resolveKgCliProjectRoot();
      const dbPath = getKgDatabasePath(projectRoot);
      if (!existsSync(dbPath)) {
        if (opts.json) {
          console.log(JSON.stringify({
            status: 'fail',
            error: { code: 'graph_not_initialized', path: dbPath },
          }, null, 2));
        } else {
          console.log('✗ MaestroGraph not initialized. Run: maestro kg init');
        }
        process.exitCode = 1;
        return;
      }

      let mg: MaestroGraph | null = null;
      try {
        mg = await MaestroGraph.open(projectRoot);
        const health = mg.getHealth();
        if (opts.json) {
          console.log(JSON.stringify({ database: dbPath, ...health }, null, 2));
          if (health.status === 'fail') process.exitCode = 1;
          return;
        }

        const icon = health.status === 'pass' ? '✓' : health.status === 'warn' ? '⚠' : '✗';
        console.log(`${icon} Database: ${dbPath}`);
        console.log(`${health.schemaVersion === KG_SCHEMA_VERSION ? '✓' : '✗'} Schema: v${health.schemaVersion}`);
        console.log(`${health.integrity.ok ? '✓' : '✗'} Integrity: ${health.integrity.messages.join(', ')}`);
        console.log(`${health.foreignKeys.ok ? '✓' : '✗'} Foreign keys: ${health.foreignKeys.violations.length} violation(s)`);
        console.log(`${health.syncState.stale ? '⚠' : '✓'} Sync state: ${health.syncState.status}`);
        if (health.syncState.error) console.log(`✗ Last sync error: ${health.syncState.error}`);
        for (const error of health.errors) console.log(`✗ Health error: ${error}`);
        if (health.structuralRefs.invariants.invalidResolved > 0) {
          console.log(`✗ Invalid resolved refs: ${health.structuralRefs.invariants.invalidResolved}`);
        }
        console.log(`Structural refs unresolved: ${health.structuralRefs.unresolved}/${health.structuralRefs.total} (${(health.structuralRefs.unresolvedRatio * 100).toFixed(1)}%)`);
        if (health.status === 'fail') process.exitCode = 1;
      } catch (error) {
        const payload = {
          status: 'fail',
          database: dbPath,
          error: {
            code: 'health_check_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
        if (opts.json) console.log(JSON.stringify(payload, null, 2));
        else console.error(`✗ Health check failed: ${payload.error.message}`);
        process.exitCode = 1;
      } finally {
        mg?.close();
      }
    });

  // ── migrate ──────────────────────────────────────────────────────
  kg
    .command('migrate')
    .description('Migrate legacy knowledge sources to MaestroGraph')
    .option('--dry-run', 'Show what would be migrated without writing')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const projectRoot = resolveKgCliProjectRoot();
      const workflowRoot = resolve(projectRoot, '.workflow');

      // Detect legacy sources
      const legacySources = [
        {
          name: 'codegraph-sqlite',
          path: resolve(projectRoot, '.codegraph'),
          estimateNodes: (p: string) => existsSync(p) ? 50 : 0,
        },
        {
          name: 'specs',
          path: resolve(workflowRoot, 'specs'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readdirSync } = require('node:fs');
              return readdirSync(p).filter((f: string) => f.endsWith('.md')).length;
            } catch { return 0; }
          },
        },
        {
          name: 'knowhow',
          path: resolve(workflowRoot, 'knowhow'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readdirSync } = require('node:fs');
              return readdirSync(p).filter((f: string) => f.endsWith('.md')).length;
            } catch { return 0; }
          },
        },
        {
          name: 'domain-glossary',
          path: existsSync(resolve(workflowRoot, 'domain', 'glossary.yaml'))
            ? resolve(workflowRoot, 'domain', 'glossary.yaml')
            : resolve(workflowRoot, 'domain', 'glossary.json'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readFileSync } = require('node:fs');
              const raw = readFileSync(p, 'utf-8');
              const data = p.endsWith('.yaml') ? require('yaml').parse(raw) : JSON.parse(raw);
              return Array.isArray(data) ? data.length : Object.keys(data).length;
            } catch { return 0; }
          },
        },
        {
          name: 'issues',
          path: resolve(workflowRoot, 'issues', 'issues.jsonl'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readFileSync } = require('node:fs');
              return readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).length;
            } catch { return 0; }
          },
        },
      ];

      const detected = legacySources.map(s => ({
        name: s.name,
        path: s.path,
        detected: existsSync(s.path),
        estimatedNodes: s.estimateNodes(s.path),
      }));

      if (opts.dryRun) {
        if (opts.json) {
          console.log(JSON.stringify({ dryRun: true, sources: detected }, null, 2));
          return;
        }
        console.log('Legacy source detection (dry run):');
        for (const s of detected) {
          const icon = s.detected ? '✓' : '✗';
          console.log(`  ${icon} ${s.name}: ${s.path} (${s.estimatedNodes} estimated nodes)`);
        }
        return;
      }

      const hasAny = detected.some(s => s.detected);
      if (!hasAny) {
        console.log('No legacy sources detected. Nothing to migrate.');
        return;
      }

      console.log('Migrating legacy sources to MaestroGraph...');
      const startMs = Date.now();

      const results = await syncKnowledgeGraph(projectRoot);

      const durationMs = Date.now() - startMs;
      const totalNodes = results.reduce((sum, r) => sum + r.nodesAdded, 0);
      const totalEdges = results.reduce((sum, r) => sum + r.edgesAdded, 0);

      if (opts.json) {
        console.log(JSON.stringify({
          sources: detected,
          results,
          summary: { nodesImported: totalNodes, edgesCreated: totalEdges, durationMs },
        }, null, 2));
        return;
      }

      console.log('Sources detected:');
      for (const s of detected) {
        const icon = s.detected ? '✓' : '✗';
        console.log(`  ${icon} ${s.name} (${s.estimatedNodes} estimated nodes)`);
      }
      console.log('\nMigration results:');
      for (const r of results) {
        console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
      }
      console.log(`\nTotal: ${totalNodes} nodes imported, ${totalEdges} edges created in ${durationMs}ms`);
    });

  // ── rebuild ──────────────────────────────────────────────────────
  kg
    .command('rebuild')
    .description('Rebuild MaestroGraph database from scratch')
    .option('--json', 'Output as JSON')
    .option('--confirm', 'Skip confirmation warning')
    .action(async (opts) => {
      const projectRoot = resolveKgCliProjectRoot();
      const dbPath = getKgDatabasePath(projectRoot);

      if (existsSync(dbPath)) {
        if (!opts.confirm) {
          console.log(`⚠ Existing database will be deleted: ${dbPath}`);
          console.log('  Use --confirm to suppress this warning.');
        }
        unlinkSync(dbPath);
        console.log('Deleted existing database.');
      }

      console.log('Rebuilding MaestroGraph from scratch...');
      const startMs = Date.now();

      // Create fresh DB
      const mg = await MaestroGraph.init(projectRoot);
      mg.close();

      // Full sync from all sources
      const results = await syncKnowledgeGraph(projectRoot, { full: true });

      const durationMs = Date.now() - startMs;
      const totalNodes = results.reduce((sum, r) => sum + r.nodesAdded, 0);
      const totalEdges = results.reduce((sum, r) => sum + r.edgesAdded, 0);

      if (opts.json) {
        console.log(JSON.stringify({
          results,
          summary: { nodesImported: totalNodes, edgesCreated: totalEdges, durationMs },
        }, null, 2));
        return;
      }

      console.log('\nRebuild results:');
      for (const r of results) {
        console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
      }
      console.log(`\nTotal: ${totalNodes} nodes, ${totalEdges} edges rebuilt in ${durationMs}ms`);
    });
}
