import { describe, expect, it, vi } from 'vitest';
import {
  isRetryableTransportError,
  withDirectProxyFallback,
  type LlmConfig,
} from './llm.js';

function makeConfig(proxyUrl?: string): LlmConfig {
  return {
    model: 'test-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    proxyUrl,
  };
}

describe('isRetryableTransportError', () => {
  it('recognizes OpenAI connection timeouts', () => {
    const error = new Error('Request timed out.');
    error.name = 'APIConnectionTimeoutError';

    expect(isRetryableTransportError(error)).toBe(true);
  });

  it('recognizes nested undici connection errors', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), {
      code: 'ECONNREFUSED',
    });
    const error = new TypeError('fetch failed', { cause });

    expect(isRetryableTransportError(error)).toBe(true);
  });

  it('does not retry HTTP API errors', () => {
    expect(isRetryableTransportError(new Error('OpenAI Responses API 401: unauthorized'))).toBe(false);
    expect(isRetryableTransportError(new Error('Anthropic API 429: rate limited'))).toBe(false);
  });
});

describe('withDirectProxyFallback', () => {
  it('retries directly when the proxy transport fails', async () => {
    const request = vi.fn(async (config: LlmConfig) => {
      if (config.proxyUrl) {
        const error = new Error('proxy refused connection');
        error.name = 'APIConnectionError';
        throw error;
      }
      return 'direct response';
    });

    await expect(withDirectProxyFallback(makeConfig('http://127.0.0.1:7890'), request))
      .resolves.toBe('direct response');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].proxyUrl).toBeUndefined();
  });

  it('does not retry when no proxy is configured', async () => {
    const error = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const request = vi.fn().mockRejectedValue(error);

    await expect(withDirectProxyFallback(makeConfig(), request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry provider errors through a second route', async () => {
    const error = new Error('OpenAI Responses API 401: unauthorized');
    const request = vi.fn().mockRejectedValue(error);

    await expect(withDirectProxyFallback(makeConfig('http://127.0.0.1:7890'), request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
