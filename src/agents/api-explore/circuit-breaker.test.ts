import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointCircuitBreaker, type NamedEndpointRef } from './circuit-breaker.js';
import { recoverTrippedEndpoints } from './runner.js';

const tempDirs: string[] = [];

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-explore-breaker-'));
  tempDirs.push(dir);
  return join(dir, 'state.json');
}

function endpoint(name: string): NamedEndpointRef {
  return {
    name,
    llmConfig: {
      model: `${name}-model`,
      baseUrl: `https://${name}.example.test`,
      apiKey: 'test-key',
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('EndpointCircuitBreaker', () => {
  it('orders healthy fallbacks by fallbackOrder before endpoint declaration order', () => {
    const breaker = new EndpointCircuitBreaker(
      { fallbackOrder: ['third', 'second'] },
      { statePath: tempStatePath() },
    );
    const endpoints = [endpoint('first'), endpoint('second'), endpoint('third')];

    expect(breaker.getFallbackCandidates('first', endpoints).map(ep => ep.name))
      .toEqual(['third', 'second']);
  });

  it('half-open probes persisted trips when no healthy endpoint remains', async () => {
    const statePath = tempStatePath();
    const now = 10_000;
    writeFileSync(statePath, JSON.stringify({
      endpoints: {
        first: { trippedAt: now - 100 },
        second: { trippedAt: now - 100 },
      },
    }));
    const breaker = new EndpointCircuitBreaker(
      { resetAfterMs: 60_000 },
      { statePath, now: () => now },
    );
    const probed: string[] = [];

    const recovered = await recoverTrippedEndpoints(
      breaker,
      [endpoint('first'), endpoint('second')],
      async config => {
        probed.push(config.model);
        return config.model === 'second-model';
      },
    );

    expect(probed).toEqual(['first-model', 'second-model']);
    expect(recovered).toEqual(['second']);
    expect(breaker.isOpen('first')).toBe(true);
    expect(breaker.isOpen('second')).toBe(false);
    expect(breaker.selectFallback('first', [endpoint('first'), endpoint('second')])?.name)
      .toBe('second');
    expect(breaker.recordFailure('second')).toBe(true);
    expect(breaker.isOpen('second')).toBe(true);
  });

  it('does not recover endpoints whose half-open probe still fails', async () => {
    const statePath = tempStatePath();
    writeFileSync(statePath, JSON.stringify({ endpoints: { first: { trippedAt: 9_900 } } }));
    const breaker = new EndpointCircuitBreaker(
      { resetAfterMs: 60_000 },
      { statePath, now: () => 10_000 },
    );

    await expect(recoverTrippedEndpoints(
      breaker,
      [endpoint('first')],
      async () => false,
    )).resolves.toEqual([]);
    expect(breaker.isOpen('first')).toBe(true);
  });
});
