/**
 * Wiki Search Tool — MCP tool exposing hybrid BM25 + semantic embedding search.
 *
 * Fast path: tries the search daemon first (no heavy imports).
 * Fallback: lazy-imports WikiIndexer for direct search.
 *
 * Result shape per entry:
 *   { id, title, type, scope, score, summary }
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';

// --- Cached WikiIndexer (lazy, only loaded when daemon is unavailable) ---

let _indexer: WikiIndexer | null = null;
let _indexerRoot: string | null = null;

async function getIndexer(workflowRoot: string): Promise<WikiIndexer> {
  if (_indexer && _indexerRoot === workflowRoot) return _indexer;
  const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
  _indexer = new Cls({ workflowRoot });
  _indexerRoot = workflowRoot;
  return _indexer;
}

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'maestro_wiki_search',
  description:
    'Search wiki knowledge base (specs, knowhow, domains, issues) with BM25 + semantic embedding hybrid search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 20)',
      },
      skipEmbedding: {
        type: 'boolean',
        description: 'Skip embedding search, use BM25 only',
      },
    },
    required: ['query'],
  },
};

// --- Handler ---

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const query = params.query as string | undefined;
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Parameter "query" is required and must be a string' };
  }

  const limit = typeof params.limit === 'number' ? params.limit : 20;
  const skipEmbedding = params.skipEmbedding === true;

  const workflowRoot = resolve(process.cwd(), '.workflow');
  if (!existsSync(workflowRoot)) {
    return {
      success: true,
      result: { results: [], embeddingUsed: false, totalResults: 0 },
    };
  }

  // Fast path: try search daemon
  try {
    const { tryDaemonSearch } = await import('../search/daemon-client.js');
    const daemonResult = await tryDaemonSearch(workflowRoot, query, limit, skipEmbedding);

    if (daemonResult?.ok && daemonResult.results) {
      const results = daemonResult.results.map((r) => ({
        id: r.entry.id,
        title: r.entry.title || 'Untitled',
        type: r.entry.type,
        scope: r.entry.scope || '',
        score: r.score,
        summary: (r.entry.summary || '').slice(0, 200),
      }));
      return {
        success: true,
        result: {
          results,
          embeddingUsed: daemonResult.embeddingUsed ?? false,
          totalResults: results.length,
        },
      };
    }
  } catch {
    // Daemon unavailable — fall through to direct search
  }

  // Fallback: direct WikiIndexer search
  try {
    const indexer = await getIndexer(workflowRoot);
    const { results: rawResults, embeddingUsed } = await indexer.searchWithMeta(query, limit, {
      skipEmbedding,
    });

    const results = rawResults.map((r) => ({
      id: r.entry.id,
      title: r.entry.title || 'Untitled',
      type: r.entry.type,
      scope: r.entry.scope || '',
      score: r.score,
      summary: (r.entry.summary || '').slice(0, 200),
    }));

    return {
      success: true,
      result: {
        results,
        embeddingUsed,
        totalResults: results.length,
      },
    };
  } catch (err) {
    return { success: false, error: `Wiki search failed: ${(err as Error).message}` };
  }
}
