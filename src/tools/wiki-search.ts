/**
 * Wiki Search Tool — MCP tool exposing low-latency BM25 with opt-in semantic reranking.
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
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import { isRepositoryApplicable } from '../repository/applicability.js';
import { getProjectRoot } from '../utils/path-validator.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { resolveRepositoryContext, type RepositoryContext } from '../repository/context.js';

// --- Cached WikiIndexer (lazy, only loaded when daemon is unavailable) ---

interface CachedWikiIndexer {
  workflowRoot: string;
  configKey: string;
  indexer: WikiIndexer;
}

let _indexer: CachedWikiIndexer | null = null;

function toLinkedWikiConfig(link: ReturnType<typeof resolveWorkspaceLinks>[number]) {
  return {
    name: link.name,
    workflowRoot: link.workflowRoot,
    shareTypes: link.share,
    repoId: link.repoId,
    repoName: link.repoName,
    workspaceFence: link.repoId ? `repo:${link.repoId}` : `linked:${link.name}`,
  };
}

function currentWikiRepository(current: RepositoryContext) {
  return {
    repoId: current.repoId,
    repoName: current.repoName,
    alias: current.alias,
    workspaceFence: current.repoId ? `repo:${current.repoId}` : undefined,
  };
}

function resolveWikiAuthority(current: RepositoryContext) {
  const linkedWorkspaces = resolveWorkspaceLinks(
    current.projectRoot,
    loadWorkspaceConfig(current.projectRoot),
  )
    .filter(link => link.valid)
    .map(toLinkedWikiConfig);
  const repository = currentWikiRepository(current);
  return {
    linkedWorkspaces,
    repository,
    configKey: JSON.stringify({ linkedWorkspaces, repository }),
  };
}

async function getIndexer(projectRoot: string): Promise<WikiIndexer> {
  const current = resolveRepositoryContext('current', { projectRoot });
  const workflowRoot = current.workflowRoot;
  const { linkedWorkspaces, repository, configKey } = resolveWikiAuthority(current);
  // Re-key on live effective authority, not only the local workflow path. A
  // resident MCP process must discard cached linked entries when sharing is
  // revoked or a linked path/identity changes.
  if (!_indexer || _indexer.workflowRoot !== workflowRoot || _indexer.configKey !== configKey) {
    if (_indexer) await _indexer.indexer.close();
    const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    _indexer = {
      workflowRoot,
      configKey,
      // The search daemon owns cache publication; MCP fallback consumes the
      // same corpus without starting a competing full-cache writer.
      indexer: new Cls({ workflowRoot, linkedWorkspaces, repository, role: 'reader' }),
    };
  }
  return _indexer.indexer;
}

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'maestro_wiki_search',
  description:
    'Search wiki knowledge base (specs, knowhow, domains, issues) with low-latency BM25 and optional semantic reranking.',
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
      semantic: {
        type: 'boolean',
        description: 'Enable slower semantic embedding reranking (default false)',
      },
      skipEmbedding: {
        type: 'boolean',
        description: 'Legacy control: true uses BM25 only; explicit false enables semantic reranking',
      },
      repo: {
        type: 'string',
        description: 'Target repository selector (current, ID, linked alias, or unique name)',
      },
    },
    required: ['query'],
  },
};

function entryVisible(
  entry: WikiEntry,
  target: RepositoryContext,
  originExplicit: boolean,
): boolean {
  if (!isRepositoryApplicable(entry, target.repoId)) return false;
  if (!originExplicit) return true;
  return target.repoId
    ? (entry.repoId ?? entry.source.repoId) === target.repoId
    : (entry.alias ?? entry.source.alias) === target.alias;
}

function repositoryFields(entry: WikiEntry) {
  return {
    repoId: entry.repoId ?? entry.source.repoId ?? null,
    repoName: entry.repoName ?? entry.source.repoName ?? null,
    alias: entry.alias ?? entry.source.alias ?? null,
    workspaceFence: entry.workspaceFence ?? entry.source.workspaceFence ?? null,
    appliesToRepoIds: entry.appliesToRepoIds ?? null,
  };
}

// --- Handler ---

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const query = params.query as string | undefined;
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Parameter "query" is required and must be a string' };
  }

  const limit = typeof params.limit === 'number' ? params.limit : 20;
  const semanticRequested = params.semantic === true || params.skipEmbedding === false;
  const skipEmbedding = params.skipEmbedding === true || !semanticRequested;

  const projectRoot = resolve(getProjectRoot());
  const workflowRoot = resolve(projectRoot, '.workflow');
  let currentRepository: RepositoryContext;
  let targetRepository: RepositoryContext;
  try {
    currentRepository = resolveRepositoryContext('current', { projectRoot });
    targetRepository = typeof params.repo === 'string'
      ? resolveRepositoryContext(params.repo, { projectRoot: currentRepository.projectRoot })
      : currentRepository;
  } catch (error) {
    return { success: false, error: `Repository resolution failed: ${(error as Error).message}` };
  }
  const explicitRepository = typeof params.repo === 'string';
  const { configKey: authorityKey } = resolveWikiAuthority(currentRepository);
  const filters = {
    ...(explicitRepository && targetRepository.repoId ? { repoId: targetRepository.repoId } : {}),
    ...(explicitRepository && !targetRepository.repoId ? { repoAlias: targetRepository.alias } : {}),
    applicableRepoId: targetRepository.repoId ?? '__legacy__',
  };
  if (!existsSync(workflowRoot)) {
    return {
      success: true,
      result: { results: [], embeddingUsed: false, totalResults: 0 },
    };
  }

  // Fast path: try search daemon
  try {
    const { tryDaemonSearch } = await import('../search/daemon-client.js');
    const daemonResult = await tryDaemonSearch(
      workflowRoot,
      query,
      limit,
      skipEmbedding,
      { filters, authorityKey },
    );

    if (daemonResult?.ok && daemonResult.results) {
      const embeddingUsed = daemonResult.embeddingUsed ?? false;
      const applicable = daemonResult.results.filter(result => entryVisible(
        result.entry,
        targetRepository,
        explicitRepository,
      ));
      const maxScore = applicable.reduce((m, r) => Math.max(m, r.score), 0);
      const results = applicable.map((r) => ({
        id: r.entry.id,
        title: r.entry.title || 'Untitled',
        type: r.entry.type,
        scope: r.entry.scope || '',
        score: maxScore > 0 ? r.score / maxScore : 0,
        rawScore: r.score,
        summary: (r.entry.summary || '').slice(0, 200),
        ...repositoryFields(r.entry),
      }));
      return {
        success: true,
        result: {
          results,
          embeddingUsed,
          scoreScale: 'normalized-to-top',
          totalResults: results.length,
        },
      };
    }
  } catch {
    // Daemon unavailable — fall through to direct search
  }

  // Fallback: direct WikiIndexer search (skip embedding to avoid ONNX cold-start)
  // Spawn daemon in background so future searches get embedding.
  try {
    const { spawnDaemon } = await import('../search/daemon-client.js');
    spawnDaemon(workflowRoot).catch(() => {});
  } catch { /* best-effort */ }

  try {
    const indexer = await getIndexer(projectRoot);
    const { results: rawResults, embeddingUsed } = await indexer.searchWithMeta(query, limit, {
      skipEmbedding: true,
      filters,
    });

    const maxScore = rawResults.reduce((m, r) => Math.max(m, r.score), 0);
    const results = rawResults
      .filter(result => entryVisible(result.entry, targetRepository, explicitRepository))
      .map((r) => ({
      id: r.entry.id,
      title: r.entry.title || 'Untitled',
      type: r.entry.type,
      scope: r.entry.scope || '',
      score: maxScore > 0 ? r.score / maxScore : 0,
      rawScore: r.score,
      summary: (r.entry.summary || '').slice(0, 200),
      ...repositoryFields(r.entry),
    }));

    return {
      success: true,
      result: {
        results,
        embeddingUsed,
        scoreScale: 'normalized-to-top',
        totalResults: results.length,
      },
    };
  } catch (err) {
    return { success: false, error: `Wiki search failed: ${(err as Error).message}` };
  }
}
