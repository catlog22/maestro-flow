/**
 * Mixture-of-Agents (MOA) core loop — Prompt Enhancer pattern.
 *
 * Runs multiple reference agents in parallel over the same query, then feeds
 * their outputs into an aggregator agent as user-prompt context. The system
 * prompt is identical for references and aggregator to keep the cache prefix
 * stable; reference outputs live in the user prompt tail only.
 */

import { readdirSync } from 'node:fs';
import { agentLoop } from './agent-loop.js';
import { createClient } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { buildExplorePrompt } from './prompt-parser.js';
import type { ResolvedMoaPreset } from './config.js';

export interface ReferenceOutput {
  endpointName: string;
  model: string;
  content: string | null;
  error?: string;
  durationMs: number;
}

export interface MoaResult {
  content: string;
  referenceOutputs: ReferenceOutput[];
  degraded: boolean;
}

export interface MoaLoopParams {
  prompt: string;
  preset: ResolvedMoaPreset;
  cwd: string;
  maxTurns?: number;
  onProgress?: (msg: string) => void;
}

export async function runReferences(
  params: MoaLoopParams,
  systemPrompt: string,
): Promise<ReferenceOutput[]> {
  const { referenceEndpoints } = params.preset;

  const settled = await Promise.allSettled(
    referenceEndpoints.map(async (ep): Promise<ReferenceOutput> => {
      const start = Date.now();
      params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — starting`);
      try {
        const { client, config } = createClient(ep.llmConfig);
        const prompt = buildExplorePrompt(params.prompt);
        const content = await agentLoop({
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
        return {
          endpointName: ep.name,
          model: ep.llmConfig.model,
          content,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        params.onProgress?.(`reference ${ep.name}:${ep.llmConfig.model} — error`);
        return {
          endpointName: ep.name,
          model: ep.llmConfig.model,
          content: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
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

  const referenceOutputs = await runReferences(params, systemPrompt);
  const degraded = referenceOutputs.every(r => r.error || !r.content);

  const enhancedPrompt = buildMoaPrompt(params.prompt, referenceOutputs);
  const finalPrompt = buildExplorePrompt(enhancedPrompt);

  const { client, config: aggConfig } = createClient(params.preset.aggregatorEndpoint.llmConfig);
  const content = await agentLoop({
    prompt: finalPrompt,
    systemPrompt,
    client,
    llmConfig: aggConfig,
    toolSchemas: TOOL_SCHEMAS,
    maxTurns: params.maxTurns,
    cwd: params.cwd,
    // temperature/maxTokens come from aggregator endpoint's own extraBody config
  });

  return { content, referenceOutputs, degraded };
}
