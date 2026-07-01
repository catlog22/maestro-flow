/**
 * Mixture-of-Agents (MOA) core — pipeline-based execution.
 *
 * moaAgentLoop delegates to the pipeline engine (moa-pipeline.ts)
 * which executes a sequence of typed steps (reference, aggregate,
 * transform, validate, loop). The pipeline is defined in the preset
 * config or passed dynamically.
 */

import { readdirSync } from 'node:fs';
import { buildSystemPrompt } from './system-prompt.js';
import { executeSteps, createPipelineContext } from './moa-pipeline.js';
import type { PipelineStep, ResolvedMoaPreset } from './config.js';

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
  pipeline?: PipelineStep[];
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
  const steps = params.pipeline ?? params.preset.steps;

  const ctx = createPipelineContext(params.prompt);

  await executeSteps(steps, ctx, {
    preset: params.preset,
    systemPrompt,
    cwd: params.cwd,
    maxTurns: params.maxTurns,
    cache: params.cache,
    cacheTtlMs: params.cacheTtlMs,
    onProgress: params.onProgress,
  });

  const degraded = ctx.referenceOutputs.length > 0 && ctx.referenceOutputs.every(r => r.error || !r.content);

  return {
    content: ctx.lastOutput,
    referenceOutputs: ctx.referenceOutputs,
    degraded,
    usage: ctx.totalUsage,
  };
}
