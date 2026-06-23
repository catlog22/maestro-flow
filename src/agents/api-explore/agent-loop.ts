import type OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';
import { callLlm, type LlmConfig } from './llm.js';
import { executeTool, type ToolSchema } from './tools.js';
import {
  emitInit,
  emitMessage,
  emitToolUse,
  emitToolResult,
  emitResult,
} from './stream-json-emitter.js';

export interface AgentLoopParams {
  prompt: string;
  systemPrompt: string;
  client: OpenAI;
  llmConfig: LlmConfig;
  toolSchemas: ToolSchema[];
  maxTurns: number;
  cwd: string;
}

export async function agentLoop(params: AgentLoopParams): Promise<string> {
  const { prompt, systemPrompt, client, llmConfig, toolSchemas, maxTurns, cwd } = params;

  emitInit();

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const tools = toolSchemas as ChatCompletionTool[];
  let totalInput = 0;
  let totalOutput = 0;
  let turn = 0;

  while (true) {
    turn++;

    if (turn > maxTurns + 1) {
      const fallback = `Reached maximum turns (${maxTurns}) without a final answer.`;
      emitMessage(fallback);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return fallback;
    }

    if (turn === maxTurns + 1) {
      messages.push({
        role: 'user',
        content: 'Maximum turns reached. Please provide your final answer based on what you have gathered so far.',
      });
    }

    let response;
    try {
      response = await callLlm(client, llmConfig, messages, tools);
    } catch (err) {
      const errMsg = `LLM API error: ${err instanceof Error ? err.message : String(err)}`;
      emitMessage(errMsg);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return errMsg;
    }

    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;

    if (response.toolCalls.length > 0) {
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

        let result: string;
        try {
          result = executeTool(tc.name, tc.arguments, cwd);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          emitToolResult(tc.id, result, true);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          continue;
        }

        emitToolResult(tc.id, result);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    } else {
      const content = response.content ?? '';
      emitMessage(content);
      emitResult({ input_tokens: totalInput, output_tokens: totalOutput });
      return content;
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
