import type { AgentResult } from '../types.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  shouldRetry?: (result: AgentResult) => boolean;
}

const defaultShouldRetry = (result: AgentResult): boolean =>
  result.status === 'error' || result.status === 'degraded';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function withRetry(
  fn: () => Promise<AgentResult>,
  config: RetryConfig,
): Promise<AgentResult> {
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry;
  let lastResult: AgentResult | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    lastResult = await fn();
    if (!shouldRetry(lastResult)) {
      return lastResult;
    }
    if (attempt < config.maxRetries) {
      const delay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
      await sleep(delay);
    }
  }

  return lastResult!;
}
