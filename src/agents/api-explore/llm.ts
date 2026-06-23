import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';

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
  /** Model-specific extra body params (e.g. Qwen enable_thinking) */
  extraBody?: Record<string, unknown>;
}

export function createClient(params: LlmConfig): {
  client: OpenAI;
  config: LlmConfig;
} {
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.baseUrl,
  });
  return { client, config: params };
}

export async function callLlm(
  client: OpenAI,
  config: LlmConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
): Promise<LlmResponse> {
  // Build request body — only include tools/tool_choice when tools are present,
  // merge extraBody for model-specific params (Qwen enable_thinking, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: config.model,
    messages,
    max_completion_tokens: 4_000,
    temperature: 0.7,
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
