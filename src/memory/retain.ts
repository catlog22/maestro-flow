import { basename } from 'node:path';

import { loadMemoryConfig } from './config.js';
import { conversationMessagesFromPayload, extractWorkingMemoryFacts } from './extract.js';
import { addMcpMemory, openConfiguredMcpSession, type McpMemorySession } from './mcp-client.js';
import { mem0Add, type Mem0Fetch } from './mem0-client.js';
import { autoStageSafeFacts, type StageResult } from './stage.js';
import { upsertFacts } from './store.js';
import {
  isExtractEnabled,
  isMcpWriteEnabled,
  isMem0WriteEnabled,
  type ConversationPayload,
  type MemoryConfig,
  type WorkingMemoryFact,
} from './types.js';

export interface RetainResult {
  extracted: WorkingMemoryFact[];
  added: WorkingMemoryFact[];
  updated: WorkingMemoryFact[];
  superseded: WorkingMemoryFact[];
  staged: StageResult[];
  skipped: boolean;
  mem0: { skipped: boolean; status?: number };
  mcp: { skipped: boolean; tool?: string };
}

/** Raw user statement for MCP add — the server extracts facts itself. */
export function statementForMcpRetain(payload: ConversationPayload): string {
  const prompt = payload.user_prompt?.trim();
  if (prompt) return prompt;
  const messages = conversationMessagesFromPayload(payload);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user' && messages[i].content.trim()) return messages[i].content.trim();
  }
  return '';
}

export async function retainWorkingMemory(
  projectRoot: string,
  payload: ConversationPayload,
  options: {
    config?: MemoryConfig;
    fetchImpl?: Mem0Fetch;
    autoStage?: boolean;
    mcpSession?: McpMemorySession;
  } = {},
): Promise<RetainResult> {
  const config = options.config ?? loadMemoryConfig(projectRoot);
  const empty = {
    extracted: [] as WorkingMemoryFact[],
    added: [] as WorkingMemoryFact[],
    updated: [] as WorkingMemoryFact[],
    superseded: [] as WorkingMemoryFact[],
    staged: [] as StageResult[],
    skipped: true,
    mem0: { skipped: true as const },
    mcp: { skipped: true as const },
  };
  if (!isExtractEnabled(config.auto) && !isMcpWriteEnabled(config)) {
    return empty;
  }
  const extracted = isExtractEnabled(config.auto) ? extractWorkingMemoryFacts(payload) : [];
  const upserted = isExtractEnabled(config.auto)
    ? upsertFacts(projectRoot, extracted, config)
    : { added: [] as WorkingMemoryFact[], updated: [] as WorkingMemoryFact[], superseded: [] as WorkingMemoryFact[] };
  const messages = conversationMessagesFromPayload(payload);
  let mem0: RetainResult['mem0'] = { skipped: true };
  let mcp: RetainResult['mcp'] = { skipped: true };
  if (isMcpWriteEnabled(config)) {
    const statement = statementForMcpRetain(payload);
    let opened: { session: McpMemorySession; owned: boolean } | null = null;
    try {
      opened = await openConfiguredMcpSession(config, options.mcpSession);
      if (!opened || !statement) {
        mcp = { skipped: true };
      } else {
        const added = await addMcpMemory(statement, opened.session, { project: basename(projectRoot) });
        mcp = { skipped: added.skipped, tool: added.tool };
      }
    } catch {
      mcp = { skipped: true };
    } finally {
      if (opened?.owned) await opened.session.close().catch(() => { /* fail-open */ });
    }
  } else if (isMem0WriteEnabled(config.auto) && messages.length > 0) {
    try {
      mem0 = await mem0Add(config, {
        messages,
        runId: payload.run_id ?? payload.session_id,
      }, options.fetchImpl);
    } catch {
      mem0 = { skipped: true };
    }
  }
  const staged = options.autoStage === false || !config.autoStageSafe || !isExtractEnabled(config.auto)
    ? []
    : autoStageSafeFacts(projectRoot, [...upserted.added, ...upserted.updated]);
  return {
    extracted,
    added: upserted.added,
    updated: upserted.updated,
    superseded: upserted.superseded,
    staged,
    skipped: !isExtractEnabled(config.auto),
    mem0,
    mcp,
  };
}
