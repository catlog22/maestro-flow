import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpMemorySession {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpCallRecord {
  name: string;
  arguments: Record<string, unknown>;
}

type JsonRpcId = number;

interface JsonRpcSuccess {
  jsonrpc?: string;
  id?: JsonRpcId | string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function toolBaseName(name: string): string {
  const cut = name.lastIndexOf('__');
  return (cut >= 0 ? name.slice(cut + 2) : name).toLowerCase();
}

function scoreTool(name: string, kind: 'search' | 'add'): number {
  const base = toolBaseName(name);
  const lower = name.toLowerCase();
  if (kind === 'search') {
    if (base === 'memory_search' || base === 'search') return 4;
    if (base.endsWith('_search') || lower.endsWith('search')) return 3;
    if (base.includes('search') || lower.includes('search')) return 2;
    return 0;
  }
  if (base === 'memory_add' || base === 'add') return 4;
  if (base.endsWith('_add') || lower.endsWith('add')) return 3;
  if (base.includes('add') || lower.includes('remember') || lower.includes('store')) return 2;
  return 0;
}

export function pickMcpTool(tools: McpToolDescriptor[], kind: 'search' | 'add'): McpToolDescriptor | undefined {
  let best: McpToolDescriptor | undefined;
  let bestScore = 0;
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || !tool.name.trim()) continue;
    const score = scoreTool(tool.name, kind);
    if (score > bestScore) {
      best = tool;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
}

function schemaProps(tool: McpToolDescriptor | undefined): Record<string, unknown> {
  const props = tool?.inputSchema?.properties;
  return props && typeof props === 'object' ? props : {};
}

function firstPresent(props: Record<string, unknown>, keys: string[]): string | undefined {
  return keys.find(key => key in props);
}

export function mapMcpSearchArgs(
  tool: McpToolDescriptor | undefined,
  query: string,
  options: { project?: string; limit?: number } = {},
): Record<string, unknown> {
  const props = schemaProps(tool);
  const queryKey = firstPresent(props, ['query', 'q', 'text']) ?? 'query';
  const args: Record<string, unknown> = { [queryKey]: query };
  const projectKey = firstPresent(props, ['project']);
  if (projectKey && options.project) args[projectKey] = options.project;
  const limitKey = firstPresent(props, ['limit', 'top_k', 'topK']);
  if (limitKey && typeof options.limit === 'number') args[limitKey] = options.limit;
  return args;
}

export function mapMcpAddArgs(
  tool: McpToolDescriptor | undefined,
  text: string,
  options: { project?: string } = {},
): Record<string, unknown> {
  const props = schemaProps(tool);
  const args: Record<string, unknown> = {};
  if ('messages' in props && !('text' in props) && !('content' in props) && !('memory' in props)) {
    args.messages = [{ role: 'user', content: text }];
  } else {
    const textKey = firstPresent(props, ['text', 'content', 'memory', 'statement']) ?? 'text';
    args[textKey] = text;
  }
  const projectKey = firstPresent(props, ['project']);
  if (projectKey && options.project) args[projectKey] = options.project;
  return args;
}

function pushText(target: string[], value: unknown, seen: Set<string>): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  target.push(trimmed);
}

/** Flatten MCP tools/call results into inject-able text blobs. */
export function textsFromMcpCallResult(body: unknown): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  if (typeof body === 'string') {
    pushText(texts, body, seen);
    return texts;
  }
  if (!body || typeof body !== 'object') return texts;
  const record = body as {
    content?: unknown;
    memory?: unknown;
    text?: unknown;
    results?: unknown;
  };
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (typeof item === 'string') {
        pushText(texts, item, seen);
        continue;
      }
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        pushText(texts, (item as { text: string }).text, seen);
      }
    }
  } else {
    pushText(texts, record.text, seen);
    pushText(texts, record.memory, seen);
  }
  if (Array.isArray(record.results)) {
    for (const row of record.results) {
      if (typeof row === 'string') pushText(texts, row, seen);
      else if (row && typeof row === 'object') {
        const item = row as { memory?: unknown; text?: unknown; content?: unknown };
        pushText(texts, item.memory ?? item.text ?? item.content, seen);
      }
    }
  }
  return texts;
}

export function createHandlerMcpSession(
  handler: (method: string, params: unknown) => Promise<unknown> | unknown,
): McpMemorySession {
  return {
    async listTools() {
      const result = await handler('tools/list', {});
      const tools = result && typeof result === 'object'
        ? (result as { tools?: unknown }).tools
        : undefined;
      return Array.isArray(tools) ? tools as McpToolDescriptor[] : [];
    },
    async callTool(name, args) {
      return handler('tools/call', { name, arguments: args });
    },
    async close() { /* handler sessions have no subprocess */ },
  };
}

function sendLine(child: ChildProcessWithoutNullStreams, payload: unknown): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

export async function openStdioMcpSession(
  command: string,
  args: string[] = [],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<McpMemorySession> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: options.env ?? process.env,
  });
  const pending = new Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let nextId = 1;
  let closed = false;

  const failAll = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: JsonRpcSuccess;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcSuccess;
    } catch {
      return;
    }
    if (parsed.id === undefined || parsed.id === null) return;
    const id = typeof parsed.id === 'number' ? parsed.id : Number(parsed.id);
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    clearTimeout(waiter.timer);
    if (parsed.error) {
      waiter.reject(new Error(parsed.error.message ?? 'MCP error'));
      return;
    }
    waiter.resolve(parsed.result);
  });

  child.on('error', (error) => {
    closed = true;
    failAll(error instanceof Error ? error : new Error(String(error)));
  });
  child.on('exit', (code, signal) => {
    closed = true;
    failAll(new Error(`MCP server exited (${code ?? signal ?? 'unknown'})`));
  });

  const request = (method: string, params?: unknown, callTimeout = timeoutMs): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('MCP session closed'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${callTimeout}ms`));
      }, callTimeout);
      pending.set(id, { resolve, reject, timer });
      sendLine(child, {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    });
  };

  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'maestro-memory', version: '0.5.86' },
    });
    sendLine(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
  } catch (error) {
    rl.close();
    if (!child.killed) child.kill();
    throw error;
  }

  return {
    async listTools() {
      const result = await request('tools/list', {});
      const tools = result && typeof result === 'object'
        ? (result as { tools?: unknown }).tools
        : undefined;
      return Array.isArray(tools) ? tools as McpToolDescriptor[] : [];
    },
    async callTool(name, callArgs) {
      return request('tools/call', { name, arguments: callArgs }, Math.max(timeoutMs, 120_000));
    },
    async close() {
      closed = true;
      failAll(new Error('MCP session closed'));
      rl.close();
      if (!child.killed) {
        child.stdin.end();
        child.kill();
      }
    },
  };
}

export async function openConfiguredMcpSession(
  config: { remote: string; mcpCommand: string; mcpArgs: string[] },
  override?: McpMemorySession,
): Promise<{ session: McpMemorySession; owned: boolean } | null> {
  if (override) return { session: override, owned: false };
  if (config.remote !== 'mcp') return null;
  const command = config.mcpCommand?.trim();
  if (!command) return null;
  const session = await openStdioMcpSession(command, config.mcpArgs ?? []);
  return { session, owned: true };
}

export async function searchMcpMemory(
  query: string,
  session: McpMemorySession,
  options: { project?: string; limit?: number } = {},
): Promise<{ skipped: boolean; tool?: string; texts: string[]; call?: McpCallRecord }> {
  const tools = await session.listTools();
  const tool = pickMcpTool(tools, 'search');
  if (!tool) return { skipped: true, texts: [] };
  const args = mapMcpSearchArgs(tool, query, options);
  const result = await session.callTool(tool.name, args);
  return {
    skipped: false,
    tool: tool.name,
    texts: textsFromMcpCallResult(result),
    call: { name: tool.name, arguments: args },
  };
}

export async function addMcpMemory(
  text: string,
  session: McpMemorySession,
  options: { project?: string } = {},
): Promise<{ skipped: boolean; tool?: string; call?: McpCallRecord }> {
  const statement = text.trim();
  if (!statement) return { skipped: true };
  const tools = await session.listTools();
  const tool = pickMcpTool(tools, 'add');
  if (!tool) return { skipped: true };
  const args = mapMcpAddArgs(tool, statement, options);
  await session.callTool(tool.name, args);
  return {
    skipped: false,
    tool: tool.name,
    call: { name: tool.name, arguments: args },
  };
}
