/**
 * Mixture-of-Agents (MOA) core — pipeline-based execution.
 *
 * moaAgentLoop delegates to the pipeline engine (moa-pipeline.ts)
 * which executes a sequence of typed steps (reference, aggregate,
 * transform, validate, loop). The pipeline is defined in the preset
 * config or passed dynamically.
 */

import { buildSystemPrompt } from './system-prompt.js';
import { executeSteps, createPipelineContext } from './moa-pipeline.js';
import type { StreamEmitter } from './stream-json-emitter.js';
import type { PipelineStep, ResolvedMoaPreset } from './config.js';
import { DEFAULT_EXPLORE_MAX_TURNS } from './config.js';
import {
  buildRepositoryMap,
  extractRepositoryMapFocusPaths,
  type RepositoryMap,
} from './repository-map.js';

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
  treeDepth?: number;
  repositoryMap?: RepositoryMap;
  onProgress?: (msg: string) => void;
  cache?: boolean;
  cacheTtlMs?: number;
  pipeline?: PipelineStep[];
  /** Protocol event sink passed to inner agent loops (default: NDJSON on stdout) */
  emitter?: StreamEmitter;
}

export async function moaAgentLoop(params: MoaLoopParams): Promise<MoaResult> {
  const repositoryMap = params.repositoryMap
    ?? buildRepositoryMap(params.cwd, {
      targetDepth: params.treeDepth,
      focusPaths: extractRepositoryMapFocusPaths([params.prompt]),
    });
  const systemPrompt = buildSystemPrompt(
    params.cwd,
    repositoryMap,
    params.maxTurns ?? DEFAULT_EXPLORE_MAX_TURNS,
  );
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
    emitter: params.emitter,
  });

  const degraded = ctx.referenceOutputs.length > 0 && ctx.referenceOutputs.every(r => r.error || !r.content);

  return {
    content: ctx.lastOutput,
    referenceOutputs: ctx.referenceOutputs,
    degraded,
    usage: ctx.totalUsage,
  };
}
