// src/graph/kg/surface/mcp-tools.ts — MCP Tool 定义
// 参考: plan-maestrograph.md Gap C1 — 9 个 MCP 工具

import { MaestroGraph } from '../engine.js';
import { searchUnified, parseQuery } from '../query/search.js';
import { bfs, findShortestPath, getCallers, getCallees, getImpactRadius, traceCallChain } from '../query/traversal.js';
import { buildContext } from '../query/context-builder.js';
import { getKgDatabasePath } from '../db/connection.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// MCP Tool Schema 定义 (9 个工具)
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
        sourceTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by source type' },
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
        maxDepth: { type: 'number', description: 'Impact propagation depth', default: 3 },
      },
      required: ['symbol'],
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
    const queries = mg.getQueryBuilder();

    const safeInt = (v: unknown, def: number, max: number): number =>
      Math.min(Math.max(1, typeof v === 'number' ? v : def), max);
    const safeStr = (v: unknown, def: string): string =>
      typeof v === 'string' ? v.slice(0, 10_000) : def;

    let result: unknown;

    switch (toolName) {
      case 'maestro_kg_search': {
        const searchOutput = mg.searchUnified(safeStr(input.query, ''), {
          sourceTypes: input.sourceTypes as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          limit: safeInt(input.limit, 20, 100),
        });
        result = { results: searchOutput.directMatches.map(r => ({
          id: r.node.id, kind: r.node.kind, name: r.node.name, sourceType: r.node.sourceType,
          definition: r.node.definition.substring(0, 300),
          filePath: r.node.filePath, startLine: r.node.startLine, score: r.score,
        })), summary: searchOutput.summary };
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
            node: { id: node.id, kind: node.kind, name: node.name, sourceType: node.sourceType, definition: node.definition },
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
        const impactResult = getImpactRadius(queries, safeStr(input.symbol, ''), safeInt(input.maxDepth, 3, 10));
        result = {
          nodeCount: impactResult.nodes.size,
          edgeCount: impactResult.edges.length,
          nodes: [...impactResult.nodes.values()].map(n => ({ id: n.id, kind: n.kind, name: n.name })),
        };
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

      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    mg.close();

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: false,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}