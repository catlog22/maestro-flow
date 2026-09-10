import type { ConversationMessage, MemoryConfig } from './types.js';

export type Mem0Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Mem0AddInput {
  messages: ConversationMessage[];
  userId?: string;
  agentId?: string;
  appId?: string;
  runId?: string;
}

export interface Mem0SearchInput {
  query: string;
  userId?: string;
  agentId?: string;
  appId?: string;
  runId?: string;
}

function entityIds(input: { userId?: string; agentId?: string; appId?: string; runId?: string }): Record<string, string> {
  const ids: Record<string, string> = {};
  if (input.userId) ids.user_id = input.userId;
  if (input.agentId) ids.agent_id = input.agentId;
  if (input.appId) ids.app_id = input.appId;
  if (input.runId) ids.run_id = input.runId;
  return ids;
}

function requireEntity(ids: Record<string, string>): Record<string, string> {
  if (Object.keys(ids).length === 0) {
    throw new Error('Mem0 request requires at least one of user_id, agent_id, app_id, run_id');
  }
  return ids;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Token ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export function mem0Configured(config: Pick<MemoryConfig, 'mem0ApiKey'>): boolean {
  return Boolean(config.mem0ApiKey?.trim());
}

export async function mem0Add(
  config: Pick<MemoryConfig, 'mem0ApiKey' | 'mem0BaseUrl' | 'mem0UserId' | 'mem0AgentId' | 'mem0AppId'>,
  input: Mem0AddInput,
  fetchImpl: Mem0Fetch = fetch,
): Promise<{ skipped: boolean; status?: number }> {
  const apiKey = config.mem0ApiKey?.trim();
  if (!apiKey) return { skipped: true };
  const ids = requireEntity(entityIds({
    userId: input.userId ?? config.mem0UserId,
    agentId: input.agentId ?? config.mem0AgentId,
    appId: input.appId ?? config.mem0AppId,
    runId: input.runId,
  }));
  const url = `${config.mem0BaseUrl.replace(/\/$/, '')}/v3/memories/add/`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      messages: input.messages.map(message => ({ role: message.role, content: message.content })),
      ...ids,
    }),
  });
  return { skipped: false, status: response.status };
}

export async function mem0Search(
  config: Pick<MemoryConfig, 'mem0ApiKey' | 'mem0BaseUrl' | 'mem0UserId' | 'mem0AgentId' | 'mem0AppId'>,
  input: Mem0SearchInput,
  fetchImpl: Mem0Fetch = fetch,
): Promise<{ skipped: boolean; status?: number; body?: unknown }> {
  const apiKey = config.mem0ApiKey?.trim();
  if (!apiKey) return { skipped: true };
  const ids = requireEntity(entityIds({
    userId: input.userId ?? config.mem0UserId,
    agentId: input.agentId ?? config.mem0AgentId,
    appId: input.appId ?? config.mem0AppId,
    runId: input.runId,
  }));
  const url = `${config.mem0BaseUrl.replace(/\/$/, '')}/v3/memories/search/`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      query: input.query,
      filters: ids,
    }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { skipped: false, status: response.status, body };
}

/** Accept the common Mem0 v2/v3 search envelopes; ignore unknown shapes. */
export function memoriesFromSearchBody(body: unknown): string[] {
  if (typeof body === 'string' && body.trim()) return [body.trim()];
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? (
          Array.isArray((body as { results?: unknown }).results) ? (body as { results: unknown[] }).results
          : Array.isArray((body as { memories?: unknown }).memories) ? (body as { memories: unknown[] }).memories
          : []
        )
      : [];
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const text = typeof row === 'string'
      ? row
      : row && typeof row === 'object'
        ? (
            typeof (row as { memory?: unknown }).memory === 'string' ? (row as { memory: string }).memory
            : typeof (row as { text?: unknown }).text === 'string' ? (row as { text: string }).text
            : typeof (row as { content?: unknown }).content === 'string' ? (row as { content: string }).content
            : ''
          )
        : '';
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    texts.push(trimmed);
  }
  return texts;
}
