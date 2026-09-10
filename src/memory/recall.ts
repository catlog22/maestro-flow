import { basename } from 'node:path';

import { loadMemoryConfig } from './config.js';
import { formatRecalledMemory, selectWorkingMemory } from './inject.js';
import { openConfiguredMcpSession, searchMcpMemory, type McpMemorySession } from './mcp-client.js';
import { memoriesFromSearchBody, mem0Search, type Mem0Fetch } from './mem0-client.js';
import { embeddingScoresForFacts, type MemoryEmbedder } from './semantic.js';
import { touchFacts, visibleFacts } from './store.js';
import { isInjectEnabled, isMcpRemoteEnabled, type MemoryConfig, type WorkingMemoryFact } from './types.js';

export interface RecallResult {
  content: string;
  facts: WorkingMemoryFact[];
  mem0: { skipped: boolean; status?: number };
  mcp: { skipped: boolean; tool?: string; texts: string[] };
}

export async function recallWorkingMemory(
  projectRoot: string,
  query: string,
  options: {
    config?: MemoryConfig;
    fetchImpl?: Mem0Fetch;
    sessionId?: string;
    touch?: boolean;
    embedder?: MemoryEmbedder;
    mcpSession?: McpMemorySession;
  } = {},
): Promise<RecallResult> {
  const config = options.config ?? loadMemoryConfig(projectRoot);
  if (!isInjectEnabled(config.auto)) {
    return { content: '', facts: [], mem0: { skipped: true }, mcp: { skipped: true, texts: [] } };
  }
  let embeddingScores: Map<string, number> | undefined;
  if (config.semantic === 'embed' && options.embedder && query.trim()) {
    embeddingScores = await embeddingScoresForFacts(
      options.embedder,
      query,
      visibleFacts(projectRoot, options.sessionId, config),
    );
  }
  const facts = selectWorkingMemory(projectRoot, query, config, options.sessionId, embeddingScores);
  if (options.touch !== false) touchFacts(projectRoot, facts.map(fact => fact.id), undefined, config);
  let mem0: RecallResult['mem0'] = { skipped: true };
  let mcp: RecallResult['mcp'] = { skipped: true, texts: [] };
  let remoteTexts: string[] = [];
  if (query.trim() && isMcpRemoteEnabled(config)) {
    let opened: { session: McpMemorySession; owned: boolean } | null = null;
    try {
      opened = await openConfiguredMcpSession(config, options.mcpSession);
      if (!opened) {
        mcp = { skipped: true, texts: [] };
      } else {
        const searched = await searchMcpMemory(query, opened.session, {
          project: basename(projectRoot),
          limit: config.recallLimit,
        });
        mcp = { skipped: searched.skipped, tool: searched.tool, texts: searched.texts };
        if (!searched.skipped) remoteTexts = searched.texts;
      }
    } catch {
      mcp = { skipped: true, texts: [] };
    } finally {
      if (opened?.owned) await opened.session.close().catch(() => { /* fail-open */ });
    }
  } else if (query.trim()) {
    try {
      const searched = await mem0Search(config, { query }, options.fetchImpl);
      mem0 = { skipped: searched.skipped, status: searched.status };
      if (!searched.skipped) remoteTexts = memoriesFromSearchBody(searched.body);
    } catch {
      mem0 = { skipped: true };
    }
  }
  return {
    content: formatRecalledMemory(facts, remoteTexts, config),
    facts,
    mem0,
    mcp,
  };
}
