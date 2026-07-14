/**
 * Code Semantic Search Tool — MCP tool exposing hybrid FTS5 + embedding vector search.
 *
 * Wraps MaestroGraph.searchHybrid() for code symbol search.
 * Returns simplified result shape: { id, name, kind, filePath, startLine, score, signature, definition }
 */

import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'maestro_code_semantic_search',
  description:
    'Semantic code search across code symbols using hybrid FTS5 + embedding vector search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (natural language or code symbol)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 20)',
        minimum: 1,
        maximum: 100,
      },
      kinds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by node kinds (e.g. function, class, interface)',
      },
    },
    required: ['query'],
  },
};

// --- Handler ---

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const query = String(params.query || '');
  const requestedLimit = typeof params.limit === 'number' ? params.limit : 20;
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 20, 100));
  const kinds = Array.isArray(params.kinds) && params.kinds.every(kind => typeof kind === 'string')
    ? [...new Set(params.kinds as string[])].slice(0, 50)
    : undefined;

  if (!query.trim()) {
    return { success: false, error: 'Parameter "query" is required' };
  }

  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    const projectPath = process.cwd();

    if (!MaestroGraph.isInitialized(projectPath)) {
      return {
        success: false,
        error: 'MaestroGraph not initialized. Run: maestro kg init && maestro kg sync',
      };
    }

    const mg = await MaestroGraph.open(projectPath);
    try {
      let results = await mg.searchHybrid(query, { limit: limit * 2 });

      // Filter by kinds if specified
      if (kinds && kinds.length > 0) {
        results = results.filter(r => kinds.includes(r.node.kind));
      }

      results = results.slice(0, limit);

      return {
        success: true,
        result: {
          results: results.map(r => ({
            id: r.node.id,
            name: r.node.name,
            kind: r.node.kind,
            filePath: r.node.filePath,
            startLine: r.node.startLine,
            score: r.score,
            signature: r.node.signature || '',
            definition: (r.node.definition || '').slice(0, 200),
          })),
          totalResults: results.length,
        },
      };
    } finally {
      mg.close();
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
