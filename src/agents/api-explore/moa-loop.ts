/**
 * Mixture-of-Agents (MOA) core loop — Prompt Enhancer pattern.
 *
 * Runs multiple reference agents in parallel over the same query, then feeds
 * their outputs into an aggregator agent as user-prompt context. The system
 * prompt is identical for references and aggregator to keep the cache prefix
 * stable; reference outputs live in the user prompt tail only.
 */

import { readdirSync } from 'node:fs';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { agentLoop } from './agent-loop.js';
import { createClient } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { buildExplorePrompt } from './prompt-parser.js';
import { computeCacheKey, readCache, writeCache } from './moa-cache.js';
import type { ResolvedMoaPreset } from './config.js';

const REFERENCE_MARKER = '--- Reference Analyses ---';

export interface ReferenceOutput {
  endpointName: string;
  model: string;
  content: string | null;
  error?: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface MoaResult {
  content: string;
  referenceOutputs: ReferenceOutput[];
  degraded: boolean;
  usage: {
    references: Array<{ endpointName: string; model: string; inputTokens: number; outputTokens: number }>;
    aggregator: { inputTokens: number; outputTokens: number };
  };
}

export interface MoaLoopParams {
  prompt: string;
  preset: ResolvedMoaPreset;
  cwd: string;
  maxTurns?: number;
  onProgress?: (msg: string) => void;
  cache?: boolean;
  cacheTtlMs?: number;
}

export async function runReferences(
  params: MoaLoopParams,
  systemPrompt: string,
): Promise<ReferenceOutput[]> {
  const { referenceEndpoints } = params.preset;

  const settled = await Promise.allSettled(
    referenceEndpoints.map(async (ep): Promise<ReferenceOutput> => {
      const start = Date.now();
      if (params.cache !== false) {
        const cacheKey = computeCacheKey(params.prompt, params.cwd, ep.name, ep.llmConfig.model);
        const cached = readCache(params.cwd, cacheKey, params.cacheTtlMs);
        if (cached) {
          params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — cache hit`);
          return cached;
        }
      }
      params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — starting`);
      try {
        const { client, config } = createClient(ep.llmConfig);
        const prompt = buildExplorePrompt(params.prompt);
        const result = await agentLoop({
          prompt,
          systemPrompt,
          client,
          llmConfig: config,
          toolSchemas: TOOL_SCHEMAS,
          maxTurns: params.maxTurns,
          cwd: params.cwd,
          // temperature/maxTokens come from endpoint's own extraBody config
        });
        params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — done`);
        const refOutput: ReferenceOutput = {
          endpointName: ep.name,
          model: ep.llmConfig.model,
          content: result.content,
          durationMs: Date.now() - start,
          usage: result.usage,
        };
        if (params.cache !== false && refOutput.content) {
          writeCache(
            params.cwd,
            computeCacheKey(params.prompt, params.cwd, ep.name, ep.llmConfig.model),
            refOutput,
            params.prompt,
            ep.name,
            ep.llmConfig.model,
            params.cacheTtlMs,
          );
        }
        return refOutput;
      } catch (err) {
        params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — error`);
        return {
          endpointName: ep.name,
          model: ep.llmConfig.model,
          content: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    }),
  );

  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const ep = referenceEndpoints[i];
    return {
      endpointName: ep.name,
      model: ep.llmConfig.model,
      content: null,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
}

export function buildMoaPrompt(originalPrompt: string, refs: ReferenceOutput[]): string {
  const hasSuccess = refs.some(r => !r.error && r.content);
  if (!hasSuccess) return originalPrompt;

  let out = `${originalPrompt}\n\n--- Reference Analyses ---\n`;
  for (const ref of refs) {
    if (ref.content) {
      out += `\n### [Reference — ${ref.endpointName}: ${ref.model}]\n${ref.content}\n`;
    } else {
      out += `\n### [Reference — ${ref.endpointName}: ${ref.model}] (unavailable: ${ref.error})\n`;
    }
  }
  out += `\nUse the reference analyses above as context. Verify their claims against actual code.\n`;
  return out;
}

export async function moaAgentLoop(params: MoaLoopParams): Promise<MoaResult> {
  let dirListing: string;
  try {
    dirListing = readdirSync(params.cwd)
      .filter(n => !n.startsWith('.'))
      .slice(0, 50)
      .join('\n');
  } catch {
    dirListing = '(unable to list)';
  }

  const systemPrompt = buildSystemPrompt(params.cwd, dirListing);

  if (params.preset.mode === 'per-turn') {
    return moaPerTurnLoop(params, systemPrompt);
  }

  const referenceOutputs = await runReferences(params, systemPrompt);
  const degraded = referenceOutputs.every(r => r.error || !r.content);

  const enhancedPrompt = buildMoaPrompt(params.prompt, referenceOutputs);
  const finalPrompt = buildExplorePrompt(enhancedPrompt);

  const { client, config: aggConfig } = createClient(params.preset.aggregatorEndpoint.llmConfig);
  const result = await agentLoop({
    prompt: finalPrompt,
    systemPrompt,
    client,
    llmConfig: aggConfig,
    toolSchemas: TOOL_SCHEMAS,
    maxTurns: params.maxTurns,
    cwd: params.cwd,
    // temperature/maxTokens come from aggregator endpoint's own extraBody config
  });

  const usage = {
    references: referenceOutputs.map(ref => ({
      endpointName: ref.endpointName,
      model: ref.model,
      inputTokens: ref.usage.inputTokens,
      outputTokens: ref.usage.outputTokens,
    })),
    aggregator: result.usage,
  };

  return { content: result.content, referenceOutputs, degraded, usage };
}

async function moaPerTurnLoop(params: MoaLoopParams, systemPrompt: string): Promise<MoaResult> {
  let latestRefs: ReferenceOutput[] = [];

  const beforeTurn = async (ctx: { turn: number; messages: ChatCompletionMessageParam[] }) => {
    const toolDigest = extractToolDigest(ctx.messages);
    const refQuery = toolDigest
      ? `${params.prompt}\n\nPrior search results:\n${toolDigest}`
      : params.prompt;

    latestRefs = await runReferences({ ...params, prompt: refQuery }, systemPrompt);

    const refSection = buildMoaPrompt('', latestRefs);
    const markerOffset = refSection.indexOf(REFERENCE_MARKER) - 2;

    const userMsgIdx = ctx.messages.findIndex(m => m.role === 'user');
    if (userMsgIdx >= 0) {
      const userContent = String(ctx.messages[userMsgIdx].content ?? '');
      const markerIdx = userContent.indexOf(REFERENCE_MARKER);
      const base = markerIdx >= 0 ? userContent.substring(0, markerIdx - 2) : userContent;
      ctx.messages[userMsgIdx] = {
        ...ctx.messages[userMsgIdx],
        content: base + refSection.substring(markerOffset),
      } as ChatCompletionMessageParam;
    }

    params.onProgress?.(`per-turn: references refreshed (turn ${ctx.turn})`);
  };

  const enhancedPrompt = buildExplorePrompt(params.prompt);
  const { client, config: aggConfig } = createClient(params.preset.aggregatorEndpoint.llmConfig);

  const result = await agentLoop({
    prompt: enhancedPrompt,
    systemPrompt,
    client,
    llmConfig: aggConfig,
    toolSchemas: TOOL_SCHEMAS,
    maxTurns: params.maxTurns,
    cwd: params.cwd,
    beforeTurn,
  });

  const usage = {
    references: latestRefs.map(ref => ({
      endpointName: ref.endpointName,
      model: ref.model,
      inputTokens: ref.usage.inputTokens,
      outputTokens: ref.usage.outputTokens,
    })),
    aggregator: result.usage,
  };

  return { content: result.content, referenceOutputs: latestRefs, degraded: false, usage };
}

function extractToolDigest(messages: ChatCompletionMessageParam[]): string {
  const toolResults = messages
    .filter(m => m.role === 'tool')
    .map(m => String((m as { content?: string }).content ?? '').slice(0, 200))
    .slice(-5);
  return toolResults.length > 0 ? toolResults.join('\n---\n') : '';
}
