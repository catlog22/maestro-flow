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

export function createClient(params: { model: string; baseUrl: string; apiKey: string }): {
  client: OpenAI;
  model: string;
} {
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.baseUrl,
  });
  return { client, model: params.model };
}

export async function callLlm(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
): Promise<LlmResponse> {
  const response = await client.chat.completions.create({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    max_completion_tokens: 16_000,
    temperature: 0.7,
  });

  const choice = response.choices[0];
  if (!choice) {
    throw new Error('No choices returned from LLM API.');
  }

  const msg = choice.message;
  const toolCalls: LlmToolCall[] = (msg.tool_calls ?? [])
    .filter(tc => tc.type === 'function')
    .map(tc => ({
      id: tc.id,
      name: (tc as { function: { name: string; arguments: string } }).function.name,
      arguments: (tc as { function: { name: string; arguments: string } }).function.arguments,
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
