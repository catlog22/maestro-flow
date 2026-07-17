import type { LlmConfig, LlmFormat } from './llm.js';
import type { CircuitBreakerConfig } from './circuit-breaker.js';
import {
  loadApiConfig,
  loadMoaConfig,
  resolveProxyConfig,
  type ApiConfig,
} from '../../config/api-config.js';

// Re-export types that were originally defined here
export type { EndpointConfig, ProxyConfig, MoaPresetConfig, MoaConfig } from '../../config/api-config.js';
export type { CircuitBreakerConfig } from './circuit-breaker.js';

export interface ExploreConfig {
  /** Legacy single-endpoint fields (backward compat) */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** API format for legacy single-endpoint (default: 'openai') */
  format?: LlmFormat;
  extraBody?: Record<string, unknown>;
  maxTurns?: number;
  concurrency?: number;
  /** Repository tree depth injected into the first explore prompt (1-6) */
  treeDepth?: number;
  /** Named endpoints for parallel multi-endpoint usage */
  endpoints?: Record<string, import('../../config/api-config.js').EndpointConfig>;
  /** Proxy config */
  proxy?: import('../../config/api-config.js').ProxyConfig;
  /** Circuit breaker for multi-endpoint failover */
  circuitBreaker?: CircuitBreakerConfig;
  /** Mixture-of-Agents presets */
  moa?: import('../../config/api-config.js').MoaConfig;
}

export function loadExploreConfig(): ExploreConfig {
  const api = loadApiConfig();
  const moa = loadMoaConfig();
  return { ...api, moa } as ExploreConfig;
}

export function getDefaultEndpoint(config: ExploreConfig): LlmConfig | null {
  const model = config.model || process.env.API_EXPLORE_MODEL || '';
  const baseUrl = config.baseUrl || process.env.API_EXPLORE_BASE_URL || '';
  const apiKey = config.apiKey || process.env.API_EXPLORE_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!model || !baseUrl || !apiKey) return null;
  const format: LlmFormat = (config.format ?? 'openai') as LlmFormat;
  return { model, baseUrl, apiKey, format, extraBody: config.extraBody };
}

export function getNamedEndpoint(name: string, config: ExploreConfig): LlmConfig | null {
  const ep = config.endpoints?.[name];
  if (!ep || !ep.model || !ep.baseUrl || !ep.apiKey) return null;
  const format: LlmFormat = (ep.format ?? 'openai') as LlmFormat;
  return { model: ep.model, baseUrl: ep.baseUrl, apiKey: ep.apiKey, format, extraBody: ep.extraBody };
}

export interface NamedEndpoint {
  name: string;
  llmConfig: LlmConfig;
  maxTurns?: number;
  /** Per-endpoint max concurrent jobs (unset = unlimited) */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// MOA Pipeline Step types
// ---------------------------------------------------------------------------

interface StepBase {
  prompt?: string;
  as?: string;
  cache?: boolean;
}

export interface ReferenceStep extends StepBase {
  type: 'reference';
  endpoints?: string[];
  tools?: boolean;
}

export interface AggregateStep extends StepBase {
  type: 'aggregate';
  endpoint?: string;
  tools?: boolean;
}

export interface TransformStep extends StepBase {
  type: 'transform';
}

export interface ValidateStep extends StepBase {
  type: 'validate';
  endpoint?: string;
  tools?: boolean;
}

export interface SupervisorStep extends StepBase {
  type: 'supervisor';
  endpoint?: string;
  tools?: boolean;
}

export interface LoopStep {
  type: 'loop';
  steps: PipelineStep[];
  maxIterations: number;
  until?: string;
}

export type PipelineStep = ReferenceStep | AggregateStep | TransformStep | ValidateStep | SupervisorStep | LoopStep;

export const DEFAULT_PIPELINE: PipelineStep[] = [
  { type: 'reference', prompt: '{{query}}' },
  { type: 'aggregate', prompt: '{{query}}\n\n{{references}}' },
];

// ---------------------------------------------------------------------------
// MOA Preset Resolution
// ---------------------------------------------------------------------------

export interface ResolvedMoaPreset {
  referenceEndpoints: NamedEndpoint[];
  aggregatorEndpoint: NamedEndpoint;
  steps: PipelineStep[];
}

export function getAllEndpoints(config: ExploreConfig): NamedEndpoint[] {
  const results: NamedEndpoint[] = [];

  const def = getDefaultEndpoint(config);
  if (def) {
    results.push({ name: 'default', llmConfig: def });
  }

  if (config.endpoints) {
    for (const [name, ep] of Object.entries(config.endpoints)) {
      if (!ep.model || !ep.baseUrl || !ep.apiKey) continue;
      const fmt: LlmFormat = (ep.format ?? 'openai') as LlmFormat;
      results.push({
        name,
        llmConfig: { model: ep.model, baseUrl: ep.baseUrl, apiKey: ep.apiKey, format: fmt, extraBody: ep.extraBody },
        maxTurns: ep.maxTurns,
        concurrency: ep.concurrency,
      });
    }
  }

  return results;
}

export function resolveEndpoints(
  config: ExploreConfig,
  endpointFilter?: string,
  all?: boolean,
): NamedEndpoint[] {
  if (endpointFilter) {
    const names = endpointFilter.split(',').map(s => s.trim()).filter(Boolean);
    const results: NamedEndpoint[] = [];
    for (const name of names) {
      const ep = name === 'default' ? getDefaultEndpoint(config) : getNamedEndpoint(name, config);
      const epConfig = config.endpoints?.[name];
      if (ep) results.push({ name, llmConfig: ep, maxTurns: epConfig?.maxTurns, concurrency: epConfig?.concurrency });
    }
    return results;
  }

  if (all) return getAllEndpoints(config);

  const allEps = getAllEndpoints(config);
  return allEps.length > 0 ? [allEps[0]] : [];
}

/**
 * Resolve the proxy URL for explore HTTP requests.
 * Priority: config.proxy → api.json proxy → api-explore.json proxy → cli-tools.json proxy.
 */
export function resolveExploreProxyUrl(config: ExploreConfig): string | undefined {
  const proxy = config.proxy ?? resolveProxyConfig();
  if (!proxy?.enabled) return undefined;
  return proxy.httpsProxy ?? proxy.httpProxy;
}

export function injectProxy(endpoints: NamedEndpoint[], proxyUrl: string | undefined): void {
  if (!proxyUrl) return;
  for (const ep of endpoints) {
    ep.llmConfig = { ...ep.llmConfig, proxyUrl };
  }
}

export const MOA_MAX_REFERENCES = 4;

export function resolveMoaPreset(config: ExploreConfig, presetName?: string): ResolvedMoaPreset | null {
  if (!config.moa) return null;

  const name = presetName ?? config.moa.defaultPreset ?? 'default';
  const preset = config.moa.presets[name];
  if (!preset || preset.enabled === false) return null;

  if (preset.referenceEndpoints.length > MOA_MAX_REFERENCES) {
    throw new Error(`MOA preset referenceEndpoints exceeds max of ${MOA_MAX_REFERENCES}`);
  }

  const resolveEp = (epName: string): NamedEndpoint | null => {
    const llmConfig = epName === 'default' ? getDefaultEndpoint(config) : getNamedEndpoint(epName, config);
    if (!llmConfig) return null;
    const epConfig = config.endpoints?.[epName];
    return { name: epName, llmConfig, maxTurns: epConfig?.maxTurns };
  };

  const refEndpoints = preset.referenceEndpoints
    .map(resolveEp)
    .filter((ep): ep is NamedEndpoint => ep !== null);

  const aggEndpoint = resolveEp(preset.aggregatorEndpoint);
  if (!aggEndpoint) return null;

  return {
    referenceEndpoints: refEndpoints,
    aggregatorEndpoint: aggEndpoint,
    steps: (preset.steps ?? DEFAULT_PIPELINE) as PipelineStep[],
  };
}
