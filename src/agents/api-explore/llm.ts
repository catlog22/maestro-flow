import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export type LlmFormat = 'openai' | 'anthropic';

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  format?: LlmFormat;
  /** Model-specific extra body params (e.g. Qwen enable_thinking) */
  extraBody?: Record<string, unknown>;
  /** Proxy URL — when set, HTTP requests use undici ProxyAgent instead of direct connection */
  proxyUrl?: string;
}

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Fast connectivity probe — GET /models with a short timeout.
 * Returns true if the endpoint responds (any HTTP status), false on timeout/connection error.
 */
export async function probeEndpoint(config: LlmConfig, timeoutMs = 3000): Promise<boolean> {
  const url = config.baseUrl.replace(/\/$/, '') + '/models';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = {
      method: 'GET',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    };
    if (config.proxyUrl) {
      opts.dispatcher = new ProxyAgent(config.proxyUrl);
      await undiciFetch(url, opts);
    } else {
      await fetch(url, opts);
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createClient(params: LlmConfig): {
  client: OpenAI;
  config: LlmConfig;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    apiKey: params.apiKey,
    baseURL: params.baseUrl,
  };
  if (params.proxyUrl) {
    opts.fetch = undiciFetch;
    opts.fetchOptions = { dispatcher: new ProxyAgent(params.proxyUrl) };
  }
  const client = new OpenAI(opts);
  return { client, config: params };
}

// ---------------------------------------------------------------------------
// Unified call dispatcher
// ---------------------------------------------------------------------------

export async function callLlm(
  client: OpenAI,
  config: LlmConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: LlmCallOptions,
): Promise<LlmResponse> {
  if (config.format === 'anthropic') {
    return callAnthropic(config, messages, tools, options);
  }
  return callOpenAi(client, config, messages, tools, options);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (existing logic)
// ---------------------------------------------------------------------------

async function callOpenAi(
  client: OpenAI,
  config: LlmConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: LlmCallOptions,
): Promise<LlmResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: config.model,
    messages,
    max_completion_tokens: options?.maxTokens ?? 2_000,
    temperature: options?.temperature ?? 0.2,
    ...config.extraBody,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await client.chat.completions.create(body) as any;

  const choice = response.choices?.[0];
  if (!choice) {
    throw new Error('No choices returned from LLM API.');
  }

  const msg = choice.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCalls: LlmToolCall[] = (msg.tool_calls ?? [])
    .filter((tc: any) => tc.type === 'function')
    .map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

  return {
    content: msg.content,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages API provider
// ---------------------------------------------------------------------------

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[] | string;
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

function openaiToolsToAnthropic(tools: ChatCompletionTool[]): AnthropicToolDef[] {
  return tools
    .filter(t => t.type === 'function')
    .map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
      input_schema: (t.function.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
}

function openaiMessagesToAnthropic(messages: ChatCompletionMessageParam[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  let system = '';
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (typeof msg.content === 'string' ? msg.content : '') + '\n';
      continue;
    }

    if (msg.role === 'user') {
      result.push({ role: 'user', content: typeof msg.content === 'string' ? msg.content : '' });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = msg as any;
      if (m.content) {
        blocks.push({ type: 'text', text: m.content });
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: safeParseJson(tc.function.arguments),
          });
        }
      }
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (msg.role === 'tool') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = msg as any;
      const toolResult: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : '',
      };
      // Anthropic expects tool_result inside a user message
      const last = result[result.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }
  }

  return { system: system.trim(), messages: result };
}

async function callAnthropic(
  config: LlmConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: LlmCallOptions,
): Promise<LlmResponse> {
  const { system, messages: anthropicMessages } = openaiMessagesToAnthropic(messages);
  const anthropicTools = openaiToolsToAnthropic(tools);

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/v1/messages`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: config.model,
    max_tokens: options?.maxTokens ?? 2000,
    messages: anthropicMessages,
    ...config.extraBody,
  };
  if (system) body.system = system;
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (anthropicTools.length > 0) {
    body.tools = anthropicTools;
    body.tool_choice = { type: 'auto' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchOpts: any = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  };
  const fetchFn = config.proxyUrl
    ? (fetchOpts.dispatcher = new ProxyAgent(config.proxyUrl), undiciFetch)
    : fetch;
  const response = await fetchFn(url, fetchOpts);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;

  let content: string | null = null;
  const toolCalls: LlmToolCall[] = [];

  for (const block of data.content ?? []) {
    if (block.type === 'text') {
      content = (content ?? '') + block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      });
    }
  }

  return {
    content,
    toolCalls,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
