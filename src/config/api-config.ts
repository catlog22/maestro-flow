// ---------------------------------------------------------------------------
// Unified API endpoint configuration loader
//
// Reads ~/.maestro/api.json for all LLM API endpoints, proxy, and
// circuit breaker config. Reads ~/.maestro/moa.json for MOA presets.
// Falls back to ~/.maestro/api-explore.json for one version cycle.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LlmFormat } from '../agents/api-explore/llm.js';
import type { CircuitBreakerConfig } from '../agents/api-explore/circuit-breaker.js';

export interface EndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  format?: LlmFormat;
  extraBody?: Record<string, unknown>;
  concurrency?: number;
  maxTurns?: number;
}

export interface ProxyConfig {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface MoaPresetConfig {
  referenceEndpoints: string[];
  aggregatorEndpoint: string;
  steps?: unknown[];
  enabled?: boolean;
}

export interface MoaConfig {
  defaultPreset?: string;
  presets: Record<string, MoaPresetConfig>;
}

export interface ApiConfig {
  version?: string;
  endpoints?: Record<string, EndpointConfig>;
  defaults?: {
    maxTurns?: number;
    concurrency?: number;
    format?: LlmFormat;
  };
  circuitBreaker?: CircuitBreakerConfig;
  proxy?: ProxyConfig;
  // Legacy single-endpoint fields (backward compat with api-explore.json)
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  format?: LlmFormat;
  extraBody?: Record<string, unknown>;
  maxTurns?: number;
  concurrency?: number;
}

const API_JSON_PATH = join(homedir(), '.maestro', 'api.json');
const API_EXPLORE_PATH = join(homedir(), '.maestro', 'api-explore.json');
const MOA_JSON_PATH = join(homedir(), '.maestro', 'moa.json');
const CLI_TOOLS_PATH = join(homedir(), '.maestro', 'cli-tools.json');

function readJsonSync<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Load API endpoint configuration.
 * Priority: api.json → api-explore.json (deprecated fallback) → empty.
 */
export function loadApiConfig(): ApiConfig {
  return readJsonSync<ApiConfig>(API_JSON_PATH)
    ?? readJsonSync<ApiConfig>(API_EXPLORE_PATH)
    ?? {};
}

/**
 * Load MOA preset configuration.
 * Priority: moa.json → api-explore.json .moa field → undefined.
 */
export function loadMoaConfig(): MoaConfig | undefined {
  const moaFile = readJsonSync<MoaConfig>(MOA_JSON_PATH);
  if (moaFile) return moaFile;

  const legacy = readJsonSync<{ moa?: MoaConfig }>(API_EXPLORE_PATH);
  return legacy?.moa;
}

/**
 * Resolve proxy configuration.
 * Priority: api.json proxy → api-explore.json proxy → cli-tools.json proxy.
 */
export function resolveProxyConfig(): ProxyConfig | undefined {
  const apiConfig = readJsonSync<{ proxy?: ProxyConfig }>(API_JSON_PATH);
  if (apiConfig?.proxy) return apiConfig.proxy;

  const legacyConfig = readJsonSync<{ proxy?: ProxyConfig }>(API_EXPLORE_PATH);
  if (legacyConfig?.proxy) return legacyConfig.proxy;

  const cliToolsConfig = readJsonSync<{ proxy?: ProxyConfig }>(CLI_TOOLS_PATH);
  return cliToolsConfig?.proxy;
}
