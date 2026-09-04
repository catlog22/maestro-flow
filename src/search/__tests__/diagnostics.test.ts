import { describe, expect, it } from 'vitest';

import {
  SEARCH_DIAGNOSTICS_MAX_FALLBACKS,
  SEARCH_DIAGNOSTICS_MAX_PHASES,
  boundedSearchDiagnostics,
  createSearchDiagnostics,
  finishSearchDiagnostics,
  sanitizeSearchDiagnostics,
  serializeSearchDiagnostics,
  withSearchDiagnosticPhase,
} from '../diagnostics.js';

describe('request-scoped search diagnostics', () => {
  it('records bounded phases and reason-coded fallbacks without sensitive fields', async () => {
    const diagnostics = createSearchDiagnostics({
      requestId: '12345678-1234-4123-8123-123456789abc',
    });
    await withSearchDiagnosticPhase(diagnostics, 'daemon-search', async () => undefined);
    diagnostics.recordFallback('daemon', 'timeout');
    diagnostics.setProvider('indexer');
    diagnostics.setCacheState('miss');
    diagnostics.setEmbedding(false, 0);
    diagnostics.setResultCount(3);
    diagnostics.setCandidateCount(12);

    const snapshot = finishSearchDiagnostics(diagnostics);
    const serialized = serializeSearchDiagnostics(snapshot);
    expect(snapshot).toMatchObject({
      schemaVersion: 'maestro-search-diagnostics/1.0',
      requestId: '12345678-1234-4123-8123-123456789abc',
      provider: 'indexer',
      cacheState: 'miss',
      resultCount: 3,
      candidateCount: 12,
    });
    expect(snapshot.phases).toEqual([
      { phase: 'daemon-search', durationMs: expect.any(Number) },
    ]);
    expect(snapshot.fallbacks).toEqual([{ source: 'daemon', reason: 'timeout' }]);
    expect(serialized).not.toContain('query');
    expect(serialized).not.toContain('body');
    expect(serialized).not.toContain('D:/');
  });

  it('isolates concurrent recorders and caps phase/fallback collections', () => {
    const first = createSearchDiagnostics();
    const second = createSearchDiagnostics();
    first.recordPhase('first', 1);
    second.recordPhase('second', 2);
    first.recordFallback('daemon', 'timeout');
    second.recordFallback('cache', 'miss');
    expect(first.snapshot().phases).toEqual([{ phase: 'first', durationMs: 1 }]);
    expect(second.snapshot().phases).toEqual([{ phase: 'second', durationMs: 2 }]);
    expect(first.snapshot().fallbacks).toEqual([{ source: 'daemon', reason: 'timeout' }]);
    expect(second.snapshot().fallbacks).toEqual([{ source: 'cache', reason: 'miss' }]);

    for (let i = 0; i < SEARCH_DIAGNOSTICS_MAX_PHASES + 2; i++) first.recordPhase('phase', i);
    for (let i = 0; i < SEARCH_DIAGNOSTICS_MAX_FALLBACKS + 2; i++) first.recordFallback('daemon', 'error');
    const snapshot = first.snapshot();
    expect(snapshot.phases.length).toBeLessThanOrEqual(SEARCH_DIAGNOSTICS_MAX_PHASES);
    expect(snapshot.fallbacks.length).toBeLessThanOrEqual(SEARCH_DIAGNOSTICS_MAX_FALLBACKS);
    expect(snapshot.truncated).toBe(true);
  });

  it('rejects malformed or path-bearing daemon payloads while tolerating valid subsets', () => {
    expect(sanitizeSearchDiagnostics({ schemaVersion: 'old', requestId: 'bad' })).toBeNull();
    expect(sanitizeSearchDiagnostics({
      schemaVersion: 'maestro-search-diagnostics/1.0',
      requestId: '12345678-1234-4123-8123-123456789abc',
      durationMs: 4,
      phases: [{ phase: 'D:/secret', durationMs: 1 }, { phase: 'ok', durationMs: 2 }],
      fallbacks: [{ source: 'daemon', reason: 'timeout' }],
      ignored: 'new-field',
    })).toMatchObject({
      phases: [{ phase: 'ok', durationMs: 2 }],
      fallbacks: [{ source: 'daemon', reason: 'timeout' }],
    });
    expect(boundedSearchDiagnostics({
      schemaVersion: 'maestro-search-diagnostics/1.0',
      requestId: '12345678-1234-4123-8123-123456789abc',
      durationMs: 1,
      phases: [],
      fallbacks: [],
    })).toBeTruthy();
  });
});
