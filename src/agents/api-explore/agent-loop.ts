import type OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';
import { callLlm, type LlmConfig, type LlmCallOptions } from './llm.js';
import { executeToolAsync, type ToolSchema } from './tools.js';
import {
  emitInit,
  emitMessage,
  emitToolUse,
  emitToolResult,
  emitResult,
} from './stream-json-emitter.js';

const SAFETY_MAX_TURNS = 100;

export interface AgentLoopParams {
  prompt: string;
  systemPrompt: string;
  client: OpenAI;
  llmConfig: LlmConfig;
  toolSchemas: ToolSchema[];
  maxTurns?: number;
  llmOptions?: LlmCallOptions;
  cwd: string;
  beforeTurn?: (ctx: { turn: number; messages: ChatCompletionMessageParam[] }) => Promise<void> | void;
}

export interface AgentLoopResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Set when the result content is an LLM API error, not a real answer */
  apiError?: boolean;
}

export async function agentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { prompt, systemPrompt, client, llmConfig, toolSchemas, cwd } = params;
  const maxTurns = params.maxTurns ?? SAFETY_MAX_TURNS;

  emitInit();

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const tools = toolSchemas as ChatCompletionTool[];
  let totalInput = 0;
  let totalOutput = 0;
  let turn = 0;
  let toolCalled = false;

  while (true) {
    turn++;

    await params.beforeTurn?.({ turn, messages });

    if (turn > maxTurns) {
      messages.push({
        role: 'user',
        content: 'Provide your final answer now based on what you have gathered.',
      });
    }

    if (turn > maxTurns + 1) {
      const fallback = `Reached safety limit (${maxTurns} turns). Partial results above.`;
      emitMessage(fallback);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return { content: fallback, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
    }

    let response;
    try {
      response = await callLlm(client, llmConfig, messages, tools, params.llmOptions);
    } catch (err) {
      const errMsg = `LLM API error: ${err instanceof Error ? err.message : String(err)}`;
      emitMessage(errMsg);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return { content: errMsg, usage: { inputTokens: totalInput, outputTokens: totalOutput }, apiError: true };
    }

    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;

    if (response.toolCalls.length > 0) {
      toolCalled = true;
      if (response.content) {
        emitMessage(response.content, true);
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of response.toolCalls) {
        emitToolUse(tc.name, safeParseJson(tc.arguments), tc.id);
      }

      const results = await Promise.all(
        response.toolCalls.map(async (tc) => {
          try {
            return { id: tc.id, result: await executeToolAsync(tc.name, tc.arguments, cwd), error: false };
          } catch (err) {
            return { id: tc.id, result: `Error: ${err instanceof Error ? err.message : String(err)}`, error: true };
          }
        }),
      );

      for (const r of results) {
        emitToolResult(r.id, r.result, r.error);
        messages.push({ role: 'tool', tool_call_id: r.id, content: r.result });
      }
    } else if (!toolCalled && turn <= 2) {
      // Anti-hallucination: force tool use before answering
      messages.push({
        role: 'assistant',
        content: response.content,
      });
      messages.push({
        role: 'user',
        content: 'You must call Search before answering. Pick a keyword from the query and search.',
      });
    } else {
      const content = response.content ?? '';
      emitMessage(content);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return { content, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
    }
  }
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
