/**
 * Parallel explore runner.
 *
 * Execution model: serial within same endpoint, parallel across endpoints.
 * Each endpoint gets its own queue; jobs in the same queue run one-by-one.
 * Different endpoint queues run concurrently.
 *
 * Per-endpoint concurrency can be raised via `endpointConcurrency` option
 * (default 1 = fully serial per endpoint).
 */

import { readdirSync } from 'node:fs';
import { createClient, probeEndpoint, type LlmConfig } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { agentLoop } from './agent-loop.js';
import { buildExplorePrompt } from './prompt-parser.js';
import { moaAgentLoop } from './moa-loop.js';
import type { ResolvedMoaPreset } from './config.js';
import { EndpointCircuitBreaker, type CircuitBreakerConfig, type NamedEndpointRef } from './circuit-breaker.js';

export interface ExploreJob {
  id: string;
  prompt: string;
  endpointName: string;
  llmConfig: LlmConfig;
  /** Per-endpoint maxTurns override */
  maxTurns?: number;
}

export interface ExploreResult {
  id: string;
  prompt: string;
  endpointName: string;
  model: string;
  content: string | null;
  error?: string;
  durationMs: number;
}

export interface RunnerOptions {
  jobs: ExploreJob[];
  cwd: string;
  maxTurns: number;
  /** Max concurrent endpoint queues (default: number of distinct endpoints) */
  concurrency: number;
  /** Max concurrent jobs within the same endpoint (default: 1 = serial) */
  endpointConcurrency?: number;
  /** When set, route each job through MOA instead of a single-endpoint agentLoop */
  moaPreset?: ResolvedMoaPreset;
  /** Circuit breaker config for endpoint failover */
  circuitBreaker?: CircuitBreakerConfig;
  /** All available endpoints for fallback routing */
  allEndpoints?: NamedEndpointRef[];
  onProgress?: (msg: string) => void;
  onJobStart?: (job: ExploreJob) => void;
  onJobDone?: (result: ExploreResult) => void;
}

function getDirListing(cwd: string): string {
  try {
    return readdirSync(cwd)
      .filter(name => !name.startsWith('.'))
      .slice(0, 50)
      .join('\n');
  } catch {
    return '(unable to list directory)';
  }
}

async function runSingleJob(
  job: ExploreJob,
  cwd: string,
  globalMaxTurns: number,
  dirListing: string,
  moaPreset?: ResolvedMoaPreset,
): Promise<ExploreResult> {
  const start = Date.now();
  try {
    if (moaPreset) {
      const moaResult = await moaAgentLoop({
        prompt: job.prompt,
        preset: moaPreset,
        cwd,
        maxTurns: globalMaxTurns,
      });
      return {
        id: job.id,
        prompt: job.prompt,
        endpointName: 'moa',
        model: `MOA(${moaPreset.aggregatorEndpoint.name})`,
        content: moaResult.content,
        durationMs: Date.now() - start,
      };
    }

    const { client, config } = createClient(job.llmConfig);
    const systemPrompt = buildSystemPrompt(cwd, dirListing);
    const prompt = buildExplorePrompt(job.prompt);

    const result = await agentLoop({
      prompt,
      systemPrompt,
      client,
      llmConfig: config,
      toolSchemas: TOOL_SCHEMAS,
      cwd,
    });

    return {
      id: job.id,
      prompt: job.prompt,
      endpointName: job.endpointName,
      model: job.llmConfig.model,
      content: result.apiError ? null : result.content,
      error: result.apiError ? result.content : undefined,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: job.id,
      prompt: job.prompt,
      endpointName: job.endpointName,
      model: job.llmConfig.model,
      content: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Drain a queue of jobs with a per-queue concurrency limit.
 * concurrency=1 means strict serial within this queue.
 */
async function drainQueue(
  queue: ExploreJob[],
  concurrency: number,
  cwd: string,
  maxTurns: number,
  dirListing: string,
  totalJobs: number,
  jobIndexMap: Map<string, number>,
  callbacks: Pick<RunnerOptions, 'onProgress' | 'onJobStart' | 'onJobDone'>,
  moaPreset?: ResolvedMoaPreset,
  breaker?: EndpointCircuitBreaker,
  allEndpoints?: NamedEndpointRef[],
): Promise<ExploreResult[]> {
  const results: ExploreResult[] = [];
  let nextIdx = 0;

  async function runSlot(): Promise<void> {
    while (nextIdx < queue.length) {
      const localIdx = nextIdx++;
      let job = queue[localIdx];
      const globalIdx = jobIndexMap.get(job.id) ?? localIdx;

      // Circuit breaker: if current endpoint is tripped, try fallback
      if (breaker?.isOpen(job.endpointName) && allEndpoints) {
        const fallback = breaker.selectFallback(job.endpointName, allEndpoints);
        if (fallback) {
          callbacks.onProgress?.(
            `[${globalIdx + 1}/${totalJobs}] ${job.endpointName} tripped, fallback → ${fallback.name}:${fallback.llmConfig.model}`,
          );
          job = { ...job, endpointName: fallback.name, llmConfig: fallback.llmConfig };
        } else {
          callbacks.onProgress?.(
            `[${globalIdx + 1}/${totalJobs}] ${job.endpointName} tripped, no fallback available — skipping`,
          );
          results.push({
            id: job.id,
            prompt: job.prompt,
            endpointName: job.endpointName,
            model: job.llmConfig.model,
            content: null,
            error: `Circuit breaker open for ${job.endpointName}, no fallback available`,
            durationMs: 0,
          });
          continue;
        }
      }

      callbacks.onJobStart?.(job);
      callbacks.onProgress?.(
        `[${globalIdx + 1}/${totalJobs}] ${job.endpointName}:${job.llmConfig.model} — starting`,
      );

      let result = await runSingleJob(job, cwd, maxTurns, dirListing, moaPreset);

      // Record success/failure for circuit breaker
      if (breaker) {
        if (result.error) {
          const tripped = breaker.recordFailure(job.endpointName);
          if (tripped) {
            callbacks.onProgress?.(
              `⚡ Circuit breaker tripped for ${job.endpointName} — subsequent jobs will use fallback`,
            );
          }
        } else {
          breaker.recordSuccess(job.endpointName);
        }
      }

      // Immediate fallback retry: try all available endpoints until one succeeds
      if (result.error && allEndpoints && allEndpoints.length > 1) {
        const tried = new Set<string>([job.endpointName]);
        for (const candidate of allEndpoints) {
          if (tried.has(candidate.name)) continue;
          if (breaker?.isOpen(candidate.name)) continue;
          tried.add(candidate.name);

          callbacks.onProgress?.(
            `[${globalIdx + 1}/${totalJobs}] ${job.endpointName} failed, retrying → ${candidate.name}:${candidate.llmConfig.model}`,
          );
          const retryJob: ExploreJob = {
            ...job,
            endpointName: candidate.name,
            llmConfig: candidate.llmConfig,
          };
          const retryResult = await runSingleJob(retryJob, cwd, maxTurns, dirListing, moaPreset);
          if (!retryResult.error) {
            result = retryResult;
            breaker?.recordSuccess(candidate.name);
            breaker?.trip(job.endpointName);
            break;
          }
          breaker?.recordFailure(candidate.name);
        }
      }

      results.push(result);
      callbacks.onJobDone?.(result);
      const status = result.error
        ? `ERROR: ${result.error}`
        : `done (${(result.durationMs / 1000).toFixed(1)}s)`;
      callbacks.onProgress?.(
        `[${globalIdx + 1}/${totalJobs}] ${result.endpointName}:${result.model} — ${status}`,
      );
    }
  }

  const slots = Math.min(concurrency, queue.length);
  await Promise.allSettled(Array.from({ length: slots }, () => runSlot()));
  return results;
}

/**
 * Run explore jobs: serial within same endpoint, parallel across endpoints.
 */
export async function runExploreJobs(opts: RunnerOptions): Promise<ExploreResult[]> {
  const {
    jobs, cwd, maxTurns, concurrency,
    endpointConcurrency = 1,
    moaPreset,
    circuitBreaker: cbConfig,
    allEndpoints,
    onProgress, onJobStart, onJobDone,
  } = opts;

  if (jobs.length === 0) return [];

  const dirListing = getDirListing(cwd);

  // Circuit breaker: shared across all endpoint queues
  const breaker = allEndpoints && allEndpoints.length > 1
    ? new EndpointCircuitBreaker(cbConfig, {
        onTrip: (name, failures) =>
          onProgress?.(`⚡ Circuit breaker: ${name} tripped after ${failures} consecutive failures`),
      })
    : undefined;

  // Pre-flight: probe endpoints not already tripped by persistent state
  if (breaker && allEndpoints && allEndpoints.length > 1) {
    const alreadyTripped = breaker.getTrippedEndpoints();
    for (const name of alreadyTripped) {
      onProgress?.(`Pre-flight: ${name} still tripped (from previous run) — skipping probe`);
    }
    const toProbe = allEndpoints.filter(ep => !alreadyTripped.includes(ep.name));
    if (toProbe.length > 0) {
      const probeResults = await Promise.all(
        toProbe.map(async (ep) => ({ name: ep.name, alive: await probeEndpoint(ep.llmConfig) })),
      );
      for (const { name, alive } of probeResults) {
        if (!alive) {
          breaker.trip(name);
          onProgress?.(`Pre-flight: ${name} unreachable — pre-tripped`);
        }
      }
    }
    const totalHealthy = allEndpoints.filter(ep => !breaker.isOpen(ep.name)).length;
    if (totalHealthy === 0) {
      onProgress?.('Pre-flight: all endpoints unreachable');
    }
  }

  // Group jobs by endpoint
  const queues = new Map<string, ExploreJob[]>();
  const jobIndexMap = new Map<string, number>();
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    jobIndexMap.set(job.id, i);
    let q = queues.get(job.endpointName);
    if (!q) { q = []; queues.set(job.endpointName, q); }
    q.push(job);
  }

  const endpointNames = [...queues.keys()];
  onProgress?.(
    `Scheduling: ${endpointNames.length} endpoint(s), ${endpointConcurrency} job(s)/endpoint, ${concurrency} max parallel`,
  );

  // Suppress stream-json-emitter NDJSON stdout writes
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;

  const allResults: ExploreResult[] = [];
  try {
    // Run endpoint queues in parallel, capped by concurrency
    const queueEntries = [...queues.entries()];
    let nextQueue = 0;

    async function runEndpointSlot(): Promise<void> {
      while (nextQueue < queueEntries.length) {
        const idx = nextQueue++;
        const [, queue] = queueEntries[idx];
        const results = await drainQueue(
          queue, endpointConcurrency, cwd, maxTurns, dirListing,
          jobs.length, jobIndexMap,
          { onProgress, onJobStart, onJobDone },
          moaPreset,
          breaker,
          allEndpoints,
        );
        allResults.push(...results);
      }
    }

    const endpointSlots = Math.min(concurrency, queueEntries.length);
    await Promise.allSettled(Array.from({ length: endpointSlots }, () => runEndpointSlot()));
  } finally {
    process.stdout.write = origStdoutWrite;
  }

  // Persist and log circuit breaker summary
  if (breaker) {
    breaker.persistState();
    const tripped = breaker.getTrippedEndpoints();
    if (tripped.length > 0) {
      onProgress?.(`Circuit breaker summary: ${tripped.join(', ')} tripped during this run`);
    }
  }

  // Return in original job order
  const resultMap = new Map(allResults.map(r => [r.id, r]));
  return jobs.map(j => resultMap.get(j.id)!).filter(Boolean);
}

export interface PromptEntry {
  prompt: string;
  endpoint?: string;
}

type NamedEndpoint = { name: string; llmConfig: LlmConfig; maxTurns?: number };

/**
 * Build job list from prompt entries. Default: 1 prompt = 1 agent (first endpoint).
 * Per-prompt `endpoint` field overrides the global endpoint selection.
 */
export function buildJobsFromEntries(
  entries: PromptEntry[],
  globalEndpoints: NamedEndpoint[],
  allEndpoints: NamedEndpoint[],
): ExploreJob[] {
  const jobs: ExploreJob[] = [];
  let counter = 0;

  const endpointMap = new Map<string, NamedEndpoint>();
  for (const ep of allEndpoints) endpointMap.set(ep.name, ep);
  for (const ep of globalEndpoints) endpointMap.set(ep.name, ep);

  for (const entry of entries) {
    let targets: NamedEndpoint[];

    if (entry.endpoint) {
      const names = entry.endpoint.split(',').map(s => s.trim()).filter(Boolean);
      targets = names
        .map(n => endpointMap.get(n))
        .filter((ep): ep is NamedEndpoint => ep !== undefined);
      if (targets.length === 0) targets = [globalEndpoints[0]];
    } else {
      targets = [globalEndpoints[0]];
    }

    for (const ep of targets) {
      counter++;
      jobs.push({
        id: `explore-${counter}`,
        prompt: entry.prompt,
        endpointName: ep.name,
        llmConfig: ep.llmConfig,
        maxTurns: ep.maxTurns,
      });
    }
  }

  return jobs;
}

/**
 * Build job list from prompts × endpoints cartesian product.
 * Used when --all flag fans one prompt to every endpoint.
 */
export function buildJobs(
  prompts: string[],
  endpoints: NamedEndpoint[],
): ExploreJob[] {
  const jobs: ExploreJob[] = [];
  let counter = 0;

  for (const prompt of prompts) {
    for (const ep of endpoints) {
      counter++;
      jobs.push({
        id: `explore-${counter}`,
        prompt,
        endpointName: ep.name,
        llmConfig: ep.llmConfig,
        maxTurns: ep.maxTurns,
      });
    }
  }

  return jobs;
}
