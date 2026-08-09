// src/graph/kg/surface/mcp-tools.ts — MCP Tool 定义
// 参考: plan-maestrograph.md Gap C1 — 9 个 MCP 工具

import { MaestroGraph, makeNodeResolutionErrorPayload } from '../engine.js';
import type { NodeResolutionErrorPayload } from '../engine.js';
import { searchUnified, parseQuery } from '../query/search.js';
import {
  bfs,
  getCallers,
  getCallees,
  normalizeTraversalDepth,
  traceCallChain,
} from '../query/traversal.js';
import type {
  HierarchyDirection,
  ImpactResult,
  PathSearchResult,
  TypeHierarchyResult,
} from '../query/traversal.js';
import { buildContext } from '../query/context-builder.js';
import { getKgDatabasePath } from '../db/connection.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOURCE_TYPES, type SourceType, type UnifiedNode } from '../db/types.js';

// ---------------------------------------------------------------------------
// MCP Tool Schema 定义 (12 个工具)
// ---------------------------------------------------------------------------

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const KG_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'maestro_kg_search',
    description: 'Search across code symbols, domain terms, spec rules, and knowledge docs',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        sourceTypes: {
          type: 'array',
          items: { type: 'string', enum: [...SOURCE_TYPES] },
          maxItems: SOURCE_TYPES.length,
          uniqueItems: true,
          description: 'Filter by source type',
        },
        nodeKinds: { type: 'array', items: { type: 'string' }, description: 'Filter by node kind' },
        limit: { type: 'number', description: 'Max results', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'maestro_kg_context',
    description: 'Get full context for a node including related code, specs, and domain knowledge',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID' },
        depth: { type: 'number', description: 'Graph traversal depth', default: 1 },
        includeCode: { type: 'boolean', description: 'Include source code', default: true },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'maestro_kg_explore',
    description: 'Explore the unified knowledge graph for a task or question',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language question' },
        projectPath: { type: 'string', description: 'Project root path' },
      },
      required: ['query'],
    },
  },
  {
    name: 'maestro_kg_trace',
    description: 'Trace call chain: A→B→C→D complete path',
    inputSchema: {
      type: 'object',
      properties: {
        startSymbol: { type: 'string', description: 'Start symbol ID' },
        endSymbol: { type: 'string', description: 'End symbol ID (optional)' },
        maxDepth: { type: 'number', description: 'Max depth', default: 5 },
        edgeKinds: { type: 'array', items: { type: 'string' }, description: 'Edge kind filter' },
      },
      required: ['startSymbol'],
    },
  },
  {
    name: 'maestro_kg_callers',
    description: 'Find who calls this function (incoming calls edges)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol ID' },
        depth: { type: 'number', description: 'Recursive depth', default: 1 },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'maestro_kg_callees',
    description: 'Find what this function calls (outgoing calls edges)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol ID' },
        depth: { type: 'number', description: 'Recursive depth', default: 1 },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'maestro_kg_impact',
    description: 'Change impact analysis: what downstream is affected by modifying X',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol being modified' },
        maxDepth: {
          type: 'integer',
          minimum: 0,
          maximum: 10,
          description: 'Impact propagation depth',
          default: 3,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'maestro_kg_hierarchy',
    description: 'Get inheritance parents and children using child-to-parent stored edges',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Exact node ID, qualified name, or unique simple name' },
        direction: {
          type: 'string',
          enum: ['parents', 'children', 'both'],
          default: 'both',
        },
        depth: {
          type: 'integer',
          minimum: 0,
          maximum: 20,
          description: 'Hierarchy depth',
          default: 3,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'maestro_kg_path',
    description: 'Find a bidirectional shortest path while preserving raw edge direction',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Exact node ID, qualified name, or unique simple name' },
        to: { type: 'string', description: 'Exact node ID, qualified name, or unique simple name' },
        maxDepth: {
          type: 'integer',
          minimum: 0,
          maximum: 50,
          description: 'Max path depth',
          default: 10,
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'maestro_kg_files',
    description: 'List indexed files with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Filter by language' },
        pattern: { type: 'string', description: 'Glob filter' },
      },
    },
  },
  {
    name: 'maestro_kg_status',
    description: 'Index status: node/edge/file counts, DB size, last update',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'maestro_kg_build_embeddings',
    description: 'Build or rebuild code embedding index for semantic search',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Precheck — D4.4 降级策略
// ---------------------------------------------------------------------------

export type KgStatus = 'ready' | 'stale' | 'uninitialized';

export interface KgPrecheck {
  status: KgStatus;
  message: string;
}

export function precheckKg(projectPath: string): KgPrecheck {
  const dbPath = getKgDatabasePath(projectPath);
  if (!existsSync(dbPath)) {
    return {
      status: 'uninitialized',
      message: 'MaestroGraph not initialized. Run: maestro kg init',
    };
  }
  return { status: 'ready', message: '' };
}

function resolveNodeForMcp(mg: MaestroGraph, query: string): UnifiedNode {
  const resolution = mg.resolveNode(query);
  if (resolution.status === 'resolved') return resolution.node;
  throw new McpNodeResolutionError(makeNodeResolutionErrorPayload(resolution));
}

class McpNodeResolutionError extends Error {
  readonly payload: NodeResolutionErrorPayload;

  constructor(payload: NodeResolutionErrorPayload) {
    super(payload.code === 'ambiguous_node'
      ? `Ambiguous node: ${payload.query}`
      : `Node not found: ${payload.query}`);
    this.payload = payload;
  }
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
// MCP Tool Handler — 统一分发
// ---------------------------------------------------------------------------

export async function handleMcpTool(
  toolName: string,
  input: Record<string, unknown>,
  projectPath: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  const check = precheckKg(projectPath);

  if (check.status === 'uninitialized' && toolName !== 'maestro_kg_status') {
    return {
      content: [{
        type: 'text',
        text: `${check.message}\n\nQuick start:\n  1. maestro kg init\n  2. maestro kg sync\n  3. Re-call this tool`,
      }],
      isError: false,
    };
  }

  try {
    const mg = await MaestroGraph.open(projectPath);
    try {
    const queries = mg.getQueryBuilder();

    const safeInt = (v: unknown, def: number, max: number): number =>
      Math.min(Math.max(1, typeof v === 'number' ? v : def), max);
    const safeStr = (v: unknown, def: string): string =>
      typeof v === 'string' ? v.slice(0, 10_000) : def;
    const safeSourceTypes = (value: unknown): SourceType[] | undefined => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > SOURCE_TYPES.length) {
        throw new Error(`sourceTypes must contain at most ${SOURCE_TYPES.length} values`);
      }
      const valid = new Set<SourceType>(SOURCE_TYPES);
      const normalized = [...new Set(value)];
      if (normalized.some(item => typeof item !== 'string' || !valid.has(item as SourceType))) {
        throw new Error(`sourceTypes contains an unsupported value`);
      }
      return normalized as SourceType[];
    };

    let result: unknown;
    let resultIsError = false;

    switch (toolName) {
      case 'maestro_kg_search': {
        // Try hybrid search first (FTS5 + vector) when embedding index file exists on disk
        let degradedReason = 'embedding-index-unavailable';
        try {
          const embPath = resolve(projectPath, '.workflow', 'kg', 'code-embedding-index.bin');
          if (existsSync(embPath)) {
            const embIdx = await mg.getCodeEmbeddingIndex();
            if (!embIdx || embIdx.nodeIds.length === 0) {
              degradedReason = 'embedding-index-empty';
            } else {
            const hybridResults = await mg.searchHybrid(safeStr(input.query, ''), {
              sourceTypes: safeSourceTypes(input.sourceTypes),
              limit: safeInt(input.limit, 20, 100),
            });
            result = {
              results: hybridResults.map(r => ({
                id: r.node.id, kind: r.node.kind, name: r.node.name, sourceType: r.node.sourceType,
                definition: r.node.definition.substring(0, 300),
                filePath: r.node.filePath, startLine: r.node.startLine, score: r.score,
              })),
              summary: {
                codeSymbols: hybridResults.filter(r => r.node.sourceType === 'codegraph').length,
                domainTerms: hybridResults.filter(r => r.node.sourceType === 'domain').length,
                specRules: hybridResults.filter(r => r.node.sourceType === 'spec').length,
                knowhowDocs: hybridResults.filter(r => r.node.sourceType === 'knowhow').length,
                total: hybridResults.length,
                hybridSearch: true,
              },
            };
            break;
            }
          }
        } catch (err) {
          degradedReason = `hybrid-error:${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
          process.stderr.write(`[MaestroGraph] Hybrid search degraded: ${degradedReason}\n`);
        }

        // Fallback: FTS5 only (original behavior)
        const searchOutput = mg.searchUnified(safeStr(input.query, ''), {
          sourceTypes: safeSourceTypes(input.sourceTypes),
          limit: safeInt(input.limit, 20, 100),
        });
        result = { results: searchOutput.directMatches.map(r => ({
          id: r.node.id, kind: r.node.kind, name: r.node.name, sourceType: r.node.sourceType,
          definition: r.node.definition.substring(0, 300),
          filePath: r.node.filePath, startLine: r.node.startLine, score: r.score,
        })), summary: { ...searchOutput.summary, hybridSearch: false, degradedReason } };
        break;
      }

      case 'maestro_kg_context': {
        const nodeId = safeStr(input.nodeId, '');
        const node = mg.getNode(nodeId);
        if (!node) {
          result = { error: `Node not found: ${nodeId}` };
        } else {
          const traversal = bfs(queries, nodeId, {
            maxDepth: safeInt(input.depth, 1, 5),
            maxNodes: 50,
          });
          result = {
            node: {
              id: node.id,
              kind: node.kind,
              name: node.name,
              sourceType: node.sourceType,
              ...(input.includeCode === false && node.sourceType === 'codegraph'
                ? {}
                : { definition: node.definition }),
            },
            related: [...traversal.nodes.values()].filter(n => n.id !== nodeId).map(n => ({
              id: n.id, kind: n.kind, name: n.name, sourceType: n.sourceType,
            })),
            edges: traversal.edges.map(e => ({ source: e.source, target: e.target, kind: e.kind })),
          };
        }
        break;
      }

      case 'maestro_kg_explore': {
        const context = buildContext(queries, safeStr(input.query, ''), { expandDepth: 2 });
        result = {
          query: input.query,
          sections: context.sections.map(s => ({ label: s.label, lines: s.lines })),
          summary: context.summary,
        };
        break;
      }

      case 'maestro_kg_trace': {
        const traceResult = traceCallChain(queries, safeStr(input.startSymbol, ''), {
          maxDepth: safeInt(input.maxDepth, 5, 10),
          edgeKinds: input.edgeKinds as string[],
        });
        result = {
          nodes: [...traceResult.nodes.values()].map(n => ({ id: n.id, kind: n.kind, name: n.name })),
          edges: traceResult.edges.map(e => ({ source: e.source, target: e.target, kind: e.kind })),
        };
        break;
      }

      case 'maestro_kg_callers': {
        const callerResults = getCallers(queries, safeStr(input.symbol, ''), safeInt(input.depth, 1, 5));
        result = callerResults.map(c => ({
          id: c.node.id, kind: c.node.kind, name: c.node.name, edgeKind: c.edge.kind,
        }));
        break;
      }

      case 'maestro_kg_callees': {
        const calleeResults = getCallees(queries, safeStr(input.symbol, ''), safeInt(input.depth, 1, 5));
        result = calleeResults.map(c => ({
          id: c.node.id, kind: c.node.kind, name: c.node.name, edgeKind: c.edge.kind,
        }));
        break;
      }

      case 'maestro_kg_impact': {
        const node = resolveNodeForMcp(mg, safeStr(input.symbol, ''));
        const impactResult = mg.getImpact(
          node.id,
          normalizeTraversalDepth(input.maxDepth, 3, 10),
          'incoming',
        );
        result = serializeImpact(node.id, impactResult);
        break;
      }

      case 'maestro_kg_hierarchy': {
        const node = resolveNodeForMcp(mg, safeStr(input.symbol, ''));
        const requestedDirection = safeStr(input.direction, 'both');
        if (!['parents', 'children', 'both'].includes(requestedDirection)) {
          throw new Error(`Invalid hierarchy direction: ${requestedDirection}`);
        }
        const hierarchy = mg.getTypeHierarchy(node.id, {
          direction: requestedDirection as HierarchyDirection,
          depth: normalizeTraversalDepth(input.depth, 3, 20),
          maxNodes: 1_000,
        });
        result = serializeHierarchy(hierarchy);
        break;
      }

      case 'maestro_kg_path': {
        const from = resolveNodeForMcp(mg, safeStr(input.from, ''));
        const to = resolveNodeForMcp(mg, safeStr(input.to, ''));
        const path = mg.findShortestPathResult(
          from.id,
          to.id,
          normalizeTraversalDepth(input.maxDepth, 10, 50),
          1_000,
        );
        result = serializePath(from.id, to.id, path);
        resultIsError = path.truncated;
        break;
      }

      case 'maestro_kg_files': {
        const stats = mg.getStats();
        result = { fileCount: stats.fileCount, filesByLanguage: {} };
        break;
      }

      case 'maestro_kg_status': {
        result = mg.getStats();
        break;
      }

      case 'maestro_kg_build_embeddings': {
        const startTime = Date.now();
        const index = await mg.buildCodeEmbeddings();
        result = {
          status: 'completed',
          nodeCount: index.nodeIds.length,
          dimension: index.dimension,
          modelId: index.modelId,
          buildTimeMs: Date.now() - startTime,
        };
        break;
      }

      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: resultIsError,
    };
    } finally {
      mg.close();
    }
  } catch (err) {
    if (err instanceof McpNodeResolutionError) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.payload }, null, 2) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}
