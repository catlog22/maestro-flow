/**
 * MOA Pipeline Engine — executes a sequence of typed steps.
 *
 * Step types: reference, aggregate, transform, validate, loop.
 * Variables are interpolated via {{name}} syntax from PipelineContext.
 */

import { agentLoop, type AgentLoopResult } from './agent-loop.js';
import { createClient } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildExplorePrompt } from './prompt-parser.js';
import { computeCacheKey, readCache, writeCache } from './moa-cache.js';
import type { PipelineStep, LoopStep, ResolvedMoaPreset, NamedEndpoint } from './config.js';
import type { ReferenceOutput } from './moa-loop.js';

// ---------------------------------------------------------------------------
// Pipeline context — shared state across steps
// ---------------------------------------------------------------------------

export interface PipelineContext {
  query: string;
  references: string;
  lastOutput: string;
  iteration: number;
  namedOutputs: Record<string, string>;
  referenceOutputs: ReferenceOutput[];
  totalUsage: {
    references: Array<{ endpointName: string; model: string; inputTokens: number; outputTokens: number }>;
    aggregator: { inputTokens: number; outputTokens: number };
  };
}

export interface PipelineParams {
  preset: ResolvedMoaPreset;
  systemPrompt: string;
  cwd: string;
  maxTurns?: number;
  cache?: boolean;
  cacheTtlMs?: number;
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Variable interpolation
// ---------------------------------------------------------------------------

export function interpolate(template: string, ctx: PipelineContext): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key: string) => {
    const parts = key.split('.');
    if (parts[0] === 'step' && parts.length === 3 && parts[2] === 'output') {
      return ctx.namedOutputs[parts[1]] ?? '';
    }
    if (key === 'query') return ctx.query;
    if (key === 'references') return ctx.references;
    if (key === 'lastOutput') return ctx.lastOutput;
    if (key === 'iteration') return String(ctx.iteration);
    return ctx.namedOutputs[key] ?? '';
  });
}

// ---------------------------------------------------------------------------
// Step executors
// ---------------------------------------------------------------------------

async function executeReference(
  step: PipelineStep & { type: 'reference' },
  ctx: PipelineContext,
  params: PipelineParams,
  stepIndex: number,
): Promise<void> {
  const endpoints = step.endpoints
    ? params.preset.referenceEndpoints.filter(ep => step.endpoints!.includes(ep.name))
    : params.preset.referenceEndpoints;

  const prompt = step.prompt ? interpolate(step.prompt, ctx) : ctx.query;
  const useTools = step.tools !== false;

  const settled = await Promise.allSettled(
    endpoints.map(async (ep): Promise<ReferenceOutput> => {
      const start = Date.now();

      if ((step.cache ?? params.cache) !== false) {
        const key = computeCacheKey(prompt, params.cwd, ep.name, ep.llmConfig.model, stepIndex);
        const cached = readCache(params.cwd, key, params.cacheTtlMs);
        if (cached) {
          params.onProgress?.(`[${stepIndex}] reference ${ep.name} — cache hit`);
          return cached;
        }
      }

      params.onProgress?.(`[${stepIndex}] reference ${ep.name}:${ep.llmConfig.model} — starting`);
      try {
        const { client, config } = createClient(ep.llmConfig);
        const result = await agentLoop({
          prompt: buildExplorePrompt(prompt),
          systemPrompt: params.systemPrompt,
          client,
          llmConfig: config,
          toolSchemas: useTools ? TOOL_SCHEMAS : [],
          maxTurns: params.maxTurns,
          cwd: params.cwd,
        });
        params.onProgress?.(`[${stepIndex}] reference ${ep.name} — done`);
        const output: ReferenceOutput = {
          endpointName: ep.name,
          model: ep.llmConfig.model,
          content: result.content,
          durationMs: Date.now() - start,
          usage: result.usage,
        };
        if ((step.cache ?? params.cache) !== false && output.content) {
          writeCache(params.cwd, computeCacheKey(prompt, params.cwd, ep.name, ep.llmConfig.model, stepIndex), output, prompt, ep.name, ep.llmConfig.model, params.cacheTtlMs);
        }
        return output;
      } catch (err) {
        params.onProgress?.(`[${stepIndex}] reference ${ep.name} — error`);
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

  const refs = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const ep = endpoints[i];
    return { endpointName: ep.name, model: ep.llmConfig.model, content: null, error: String(s.reason), durationMs: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  });

  ctx.referenceOutputs = refs;
  for (const ref of refs) {
    ctx.totalUsage.references.push({ endpointName: ref.endpointName, model: ref.model, inputTokens: ref.usage.inputTokens, outputTokens: ref.usage.outputTokens });
  }

  const formatted = formatReferences(refs);
  ctx.references = formatted;
  storeOutput(ctx, step.as, formatted);
}

async function executeAggregate(
  step: PipelineStep & { type: 'aggregate' },
  ctx: PipelineContext,
  params: PipelineParams,
  stepIndex: number,
): Promise<void> {
  const ep = step.endpoint
    ? params.preset.referenceEndpoints.find(e => e.name === step.endpoint) ?? params.preset.aggregatorEndpoint
    : params.preset.aggregatorEndpoint;

  const prompt = step.prompt ? interpolate(step.prompt, ctx) : `${ctx.query}\n\n${ctx.references}`;
  const useTools = step.tools !== false;

  params.onProgress?.(`[${stepIndex}] aggregate ${ep.name} — starting`);
  const result = await runSingleAgent(ep, prompt, useTools, params);
  params.onProgress?.(`[${stepIndex}] aggregate ${ep.name} — done`);

  ctx.totalUsage.aggregator = {
    inputTokens: ctx.totalUsage.aggregator.inputTokens + result.usage.inputTokens,
    outputTokens: ctx.totalUsage.aggregator.outputTokens + result.usage.outputTokens,
  };
  storeOutput(ctx, step.as, result.content);
}

function executeTransform(
  step: PipelineStep & { type: 'transform' },
  ctx: PipelineContext,
  _stepIndex: number,
): void {
  const output = step.prompt ? interpolate(step.prompt, ctx) : ctx.lastOutput;
  storeOutput(ctx, step.as, output);
}

async function executeValidate(
  step: PipelineStep & { type: 'validate' },
  ctx: PipelineContext,
  params: PipelineParams,
  stepIndex: number,
): Promise<void> {
  const ep = step.endpoint
    ? params.preset.referenceEndpoints.find(e => e.name === step.endpoint) ?? params.preset.aggregatorEndpoint
    : params.preset.aggregatorEndpoint;

  const prompt = step.prompt ? interpolate(step.prompt, ctx) : `Validate:\n${ctx.lastOutput}`;
  const useTools = step.tools !== false;

  params.onProgress?.(`[${stepIndex}] validate ${ep.name} — starting`);
  const result = await runSingleAgent(ep, prompt, useTools, params);
  params.onProgress?.(`[${stepIndex}] validate ${ep.name} — done`);

  ctx.totalUsage.aggregator = {
    inputTokens: ctx.totalUsage.aggregator.inputTokens + result.usage.inputTokens,
    outputTokens: ctx.totalUsage.aggregator.outputTokens + result.usage.outputTokens,
  };
  storeOutput(ctx, step.as, result.content);
}

async function executeLoop(
  step: LoopStep,
  ctx: PipelineContext,
  params: PipelineParams,
  baseStepIndex: number,
): Promise<void> {
  for (let i = 0; i < step.maxIterations; i++) {
    ctx.iteration = i + 1;
    params.onProgress?.(`[${baseStepIndex}] loop iteration ${ctx.iteration}/${step.maxIterations}`);

    const prevOutput = ctx.lastOutput;
    await executeSteps(step.steps, ctx, params, baseStepIndex * 100 + i * 10);

    if (step.until === 'noNewFindings' && prevOutput && ctx.lastOutput) {
      const similarity = computeSimilarity(prevOutput, ctx.lastOutput);
      if (similarity > 0.95) {
        params.onProgress?.(`[${baseStepIndex}] loop converged (similarity ${(similarity * 100).toFixed(0)}%)`);
        break;
      }
    }
  }
  ctx.iteration = 0;
}

// ---------------------------------------------------------------------------
// Main pipeline executor
// ---------------------------------------------------------------------------

export async function executeSteps(
  steps: PipelineStep[],
  ctx: PipelineContext,
  params: PipelineParams,
  baseIndex = 0,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepIndex = baseIndex + i;

    switch (step.type) {
      case 'reference':
        await executeReference(step, ctx, params, stepIndex);
        break;
      case 'aggregate':
        await executeAggregate(step, ctx, params, stepIndex);
        break;
      case 'transform':
        executeTransform(step, ctx, stepIndex);
        break;
      case 'validate':
        await executeValidate(step, ctx, params, stepIndex);
        break;
      case 'loop':
        await executeLoop(step, ctx, params, stepIndex);
        break;
    }
  }
}

export function createPipelineContext(query: string): PipelineContext {
  return {
    query,
    references: '',
    lastOutput: '',
    iteration: 0,
    namedOutputs: {},
    referenceOutputs: [],
    totalUsage: {
      references: [],
      aggregator: { inputTokens: 0, outputTokens: 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storeOutput(ctx: PipelineContext, as: string | undefined, value: string): void {
  ctx.lastOutput = value;
  if (as) ctx.namedOutputs[as] = value;
}

async function runSingleAgent(ep: NamedEndpoint, prompt: string, useTools: boolean, params: PipelineParams): Promise<AgentLoopResult> {
  const { client, config } = createClient(ep.llmConfig);
  return agentLoop({
    prompt: buildExplorePrompt(prompt),
    systemPrompt: params.systemPrompt,
    client,
    llmConfig: config,
    toolSchemas: useTools ? TOOL_SCHEMAS : [],
    maxTurns: params.maxTurns,
    cwd: params.cwd,
  });
}

function formatReferences(refs: ReferenceOutput[]): string {
  const hasSuccess = refs.some(r => !r.error && r.content);
  if (!hasSuccess) return '';

  let out = '--- Reference Analyses ---\n';
  for (const ref of refs) {
    if (ref.content) {
      out += `\n### [Reference — ${ref.endpointName}: ${ref.model}]\n${ref.content}\n`;
    } else {
      out += `\n### [Reference — ${ref.endpointName}: ${ref.model}] (unavailable: ${ref.error})\n`;
    }
  }
  out += '\nUse the reference analyses above as context. Verify their claims against actual code.\n';
  return out;
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / Math.max(setA.size, setB.size);
}
